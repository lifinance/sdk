import type { Route } from '@lifi/types'
import { config } from '../config.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { ProviderError } from '../errors/errors.js'
import { executionState } from './executionState.js'
import { prepareRestart } from './prepareRestart.js'
import type { ExecutionOptions, RouteExtended } from './types.js'

/**
 * Execute a route.
 * @param route - The route that should be executed. Cannot be an active route.
 * @param executionOptions - An object containing settings and callbacks.
 * @returns The executed route.
 * @throws {LiFiError} Throws a LiFiError if the execution fails.
 */
export const executeRoute = async (
  route: Route,
  executionOptions?: ExecutionOptions
): Promise<RouteExtended> => {
  // Deep clone to prevent side effects
  const clonedRoute = structuredClone<Route>(route)

  let executionPromise = executionState.get(clonedRoute.id)?.promise
  // Check if route is already running
  if (executionPromise) {
    return executionPromise
  }

  executionState.create({ route: clonedRoute, executionOptions })
  executionPromise = executeSteps(clonedRoute)
  executionState.update({
    route: clonedRoute,
    promise: executionPromise,
  })

  return executionPromise
}

/**
 * Resume the execution of a route that has been stopped or had an error while executing.
 * @param route - The route that is to be executed. Cannot be an active route.
 * @param executionOptions - An object containing settings and callbacks.
 * @returns The executed route.
 * @throws {LiFiError} Throws a LiFiError if the execution fails.
 */
export const resumeRoute = async (
  route: Route,
  executionOptions?: ExecutionOptions
): Promise<RouteExtended> => {
  const execution = executionState.get(route.id)

  if (execution) {
    const executionHalted = execution.executors.some(
      (executor) => !executor.allowExecution
    )
    if (!executionHalted) {
      // Check if we want to resume route execution in the background
      updateRouteExecution(route, {
        executeInBackground: executionOptions?.executeInBackground,
      })
      if (!execution.promise) {
        // We should never reach this point if we do clean-up properly
        throw new Error('Route execution promise not found.')
      }
      return execution.promise
    }
  }

  prepareRestart(route)

  return executeRoute(route, executionOptions)
}

const executeSteps = async (route: RouteExtended): Promise<RouteExtended> => {
  // Loop over steps and execute them
  for (let index = 0; index < route.steps.length; index++) {
    const execution = executionState.get(route.id)
    // Check if execution has stopped in the meantime
    if (!execution) {
      break
    }

    const step = route.steps[index]
    const previousStep = route.steps[index - 1]
    // Check if the step is already done
    //
    if (step.execution?.status === 'DONE') {
      continue
    }

    // Update step fromAmount using output of the previous step execution. In the future this should be handled by calling `updateRoute`
    if (previousStep?.execution?.toAmount) {
      step.action.fromAmount = previousStep.execution.toAmount
      if (step.includedSteps?.length) {
        step.includedSteps[0].action.fromAmount =
          previousStep.execution.toAmount
      }
    }

    try {
      const fromAddress = step.action.fromAddress
      if (!fromAddress) {
        throw new Error('Action fromAddress is not specified.')
      }

      const provider = config
        .get()
        .providers.find((provider) => provider.isAddress(fromAddress))

      if (!provider) {
        throw new ProviderError(
          LiFiErrorCode.ProviderUnavailable,
          'SDK Execution Provider not found.'
        )
      }

      const stepExecutor = await provider.getStepExecutor({
        routeId: route.id,
        executionOptions: execution.executionOptions,
      })
      execution.executors.push(stepExecutor)

      // Check if we want to execute this step in the background
      if (execution.executionOptions) {
        updateRouteExecution(route, execution.executionOptions)
      }

      const executedStep = await stepExecutor.executeStep(step)

      // We may reach this point if user interaction isn't allowed. We want to stop execution until we resume it
      if (executedStep.execution?.status !== 'DONE') {
        stopRouteExecution(route)
      }

      // Execution stopped during the current step, we don't want to continue to the next step so we return already
      if (!stepExecutor.allowExecution) {
        return route
      }
    } catch (e) {
      stopRouteExecution(route)
      throw e
    }
  }

  // Clean up after the execution
  executionState.delete(route.id)
  return route
}

/**
 * Updates route execution to background or foreground state.
 * @param route - A route that is currently in execution.
 * @param options - An object with execution settings.
 */
export const updateRouteExecution = (
  route: Route,
  options: ExecutionOptions
): void => {
  const execution = executionState.get(route.id)
  if (!execution) {
    return
  }

  if ('executeInBackground' in options) {
    for (const executor of execution.executors) {
      executor.setInteraction({
        allowInteraction: !options?.executeInBackground,
        allowUpdates: true,
      })
    }
  }
  // Update active route settings so we know what the current state of execution is
  execution.executionOptions = {
    ...execution.executionOptions,
    ...options,
  }
}

/**
 * Stops the execution of an active route.
 * @param route - A route that is currently in execution.
 * @returns The stopped route.
 */
export const stopRouteExecution = (route: Route): Route => {
  const execution = executionState.get(route.id)
  if (!execution) {
    return route
  }

  for (const executor of execution.executors) {
    executor.setInteraction({
      allowInteraction: false,
      allowUpdates: false,
      allowExecution: false,
    })
  }
  executionState.delete(route.id)
  return execution.route
}

/**
 * Get the list of active routes.
 * @returns A list of routes.
 */
export const getActiveRoutes = (): RouteExtended[] => {
  return Object.values(executionState.state)
    .map((dict) => dict?.route)
    .filter(Boolean) as RouteExtended[]
}

/**
 * Return the current route information for given route. The route has to be active.
 * @param routeId - A route id.
 * @returns The updated route.
 */
export const getActiveRoute = (routeId: string): RouteExtended | undefined => {
  return executionState.get(routeId)?.route
}
