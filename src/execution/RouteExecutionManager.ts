/* eslint-disable @typescript-eslint/no-empty-function */
import type { Route } from '@lifi/types'
import type { ProviderType, SDKProvider } from '../providers/types.js'
import { ConfigService } from '../services/ConfigService.js'
import type { SDKOptions } from '../types/index.js'
import { ValidationError } from '../utils/errors.js'
import type { BaseStepExecutor } from './BaseStepExecutor.js'
import { StatusManager } from './StatusManager.js'
import { prepareRestart } from './prepareRestart.js'
import type { ExecutionSettings, InternalExecutionSettings } from './types.js'

export interface RouteExecutionData {
  route: Route
  executors: BaseStepExecutor[]
  settings: InternalExecutionSettings
}

export type RouteExecutionDataDictionary = Partial<
  Record<string, RouteExecutionData>
>

export type RouteExecutionDictionary = Partial<Record<string, Promise<Route>>>

export class RouteExecutionManager {
  private executionDataDictionary: RouteExecutionDataDictionary = {}
  private executionDictionary: RouteExecutionDictionary = {}
  protected configService: ConfigService
  private providers?: SDKProvider[]

  constructor(options: SDKOptions) {
    this.configService = ConfigService.getInstance()
    this.configService.updateConfig(options)
    this.providers = options.providers
  }

  /**
   * Execute a route.
   * @param route - The route that should be executed. Cannot be an active route.
   * @param settings - An object containing settings and callbacks.
   * @returns The executed route.
   * @throws {LiFiError} Throws a LiFiError if the execution fails.
   */
  executeRoute = async (
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    // Deep clone to prevent side effects
    const clonedRoute = structuredClone<Route>(route)

    let executionPromise = this.executionDictionary[clonedRoute.id]
    // Check if route is already running
    if (executionPromise) {
      return executionPromise
    }

    executionPromise = this.executeSteps(clonedRoute, settings)

    this.executionDictionary[clonedRoute.id] = executionPromise

    return executionPromise
  }

  /**
   * Resume the execution of a route that has been stopped or had an error while executing.
   * @param route - The route that is to be executed. Cannot be an active route.
   * @param settings - An object containing settings and callbacks.
   * @returns The executed route.
   * @throws {LiFiError} Throws a LiFiError if the execution fails.
   */
  resumeRoute = async (
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    // Deep clone to prevent side effects
    const clonedRoute = structuredClone<Route>(route)

    const execution = this.executionDataDictionary[clonedRoute.id]

    if (execution) {
      const executionHalted = execution.executors.some(
        (executor) => !executor.allowExecution
      )
      if (!executionHalted) {
        // Check if we want to resume route execution in the background
        this.updateRouteExecution(route, {
          executeInBackground: settings?.executeInBackground,
        })
        const executionPromise = this.executionDictionary[clonedRoute.id]
        return executionPromise ?? clonedRoute
      }
    }

    await prepareRestart(clonedRoute)

    const executionPromise = this.executeSteps(clonedRoute, settings)

    this.executionDictionary[clonedRoute.id] = executionPromise

    return executionPromise
  }

  private executeSteps = async (
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    const config = this.configService.getConfig()

    const _settings = { ...config.defaultExecutionSettings, ...settings }
    this.executionDataDictionary[route.id] = {
      route,
      executors: [],
      settings: { ...config.defaultExecutionSettings, ...settings },
    }

    const statusManager = new StatusManager(
      route,
      _settings,
      (route: Route) => {
        const execution = this.executionDataDictionary[route.id]
        if (execution) {
          execution.route = route
        }
      }
    )

    // Loop over steps and execute them
    for (let index = 0; index < route.steps.length; index++) {
      const execution = this.executionDataDictionary[route.id]
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

      // Update amount using output of previous execution. In the future this should be handled by calling `updateRoute`
      if (previousStep?.execution?.toAmount) {
        step.action.fromAmount = previousStep.execution.toAmount
      }

      try {
        const provider = this.providers?.find((provider) =>
          provider.isProviderStep(step)
        )

        if (!provider) {
          throw new Error('SDK Execution Provider not found.')
        }

        const stepExecutor = await provider.getStepExecutor({
          statusManager,
          settings: execution.settings,
        })
        execution.executors.push(stepExecutor)

        // Check if we want to execute this step in the background
        this.updateRouteExecution(route, execution.settings)

        const executedStep = await stepExecutor.executeStep(step)

        // We may reach this point if user interaction isn't allowed. We want to stop execution until we resume it
        if (executedStep.execution?.status !== 'DONE') {
          this.stopExecution(route)
        }

        // Execution stopped during the current step, we don't want to continue to the next step so we return already
        if (stepExecutor.allowExecution) {
          return route
        }
      } catch (e) {
        this.stopExecution(route)
        throw e
      }
    }

    // Clean up after the execution
    delete this.executionDataDictionary[route.id]
    return route
  }

  /**
   * Updates route execution to background or foreground state.
   * @param route - A route that is currently in execution.
   * @param settings - An object with execution settings.
   */
  updateRouteExecution = (
    route: Route,
    settings: Pick<ExecutionSettings, 'executeInBackground'>
  ): void => {
    const execution = this.executionDataDictionary[route.id]
    if (!execution) {
      return
    }

    for (const executor of execution.executors) {
      executor.setInteraction({
        allowInteraction: !settings.executeInBackground,
        allowUpdates: true,
      })
    }
    // Update active route settings so we know what the current state of execution is
    execution.settings = {
      ...execution.settings,
      ...settings,
    }
  }

  /**
   * Update the ExecutionSettings for an active route.
   * @param settings - An object with execution settings.
   * @param route - The active route that gets the new execution settings.
   * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
   */
  updateExecutionSettings = (
    settings: ExecutionSettings,
    route: Route
  ): void => {
    const execution = this.executionDataDictionary[route.id]
    if (!execution) {
      throw new ValidationError(
        "Can't set ExecutionSettings for the inactive route."
      )
    }

    const config = this.configService.getConfig()

    execution.settings = {
      ...config.defaultExecutionSettings,
      ...settings,
    }
  }

  /**
   * Stops the execution of an active route.
   * @param route - A route that is currently in execution.
   * @returns The stopped route.
   */
  stopExecution = (route: Route): Route => {
    const execution = this.executionDataDictionary[route.id]
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
    delete this.executionDataDictionary[route.id]
    return route
  }

  /**
   * Get the list of active routes.
   * @returns A list of routes.
   */
  getActiveRoutes = (): Route[] => {
    return Object.values(this.executionDataDictionary)
      .map((dict) => dict?.route)
      .filter(Boolean) as Route[]
  }

  /**
   * Return the current route information for given route. The route has to be active.
   * @param route - A route object.
   * @returns The updated route.
   */
  getActiveRoute = (route: Route): Route | undefined => {
    return this.executionDataDictionary[route.id]?.route
  }

  getProvider = (type: ProviderType): SDKProvider | undefined => {
    return this.providers?.find((provider) => provider.type === type)
  }
}
