/* eslint-disable @typescript-eslint/no-empty-function */
import { Route } from '@lifi/types'
import { Signer } from 'ethers'
import ConfigService from '../services/ConfigService'
import {
  ConfigUpdate,
  ExecutionSettings,
  RouteExecutionData,
  RouteExecutionDictionary,
  RouteExecutionPromiseDictionary,
} from '../types'
import { ValidationError } from '../utils/errors'
import { handlePreRestart } from '../utils/preRestart'
import { StatusManager } from './StatusManager'
import { StepExecutor } from './StepExecutor'

export class RouteExecutionManager {
  private executionDictionary: RouteExecutionDictionary = {}
  private executionPromiseDictionary: RouteExecutionPromiseDictionary = {}
  protected configService: ConfigService

  constructor(configUpdate: ConfigUpdate) {
    this.configService = ConfigService.getInstance()

    if (configUpdate) {
      // Update API urls before we request chains
      this.configService.updateConfig(configUpdate)
    }
  }

  /**
   * Execute a route.
   * @param {Signer} signer - The signer required to send the transactions.
   * @param {Route} route - The route that should be executed. Cannot be an active route.
   * @param {ExecutionSettings} settings - An object containing settings and callbacks.
   * @return {Promise<Route>} The executed route.
   * @throws {LifiError} Throws a LifiError if the execution fails.
   */
  executeRoute = async (
    signer: Signer,
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    // Deep clone to prevent side effects
    const clonedRoute = structuredClone<Route>(route)

    let executionPromise = this.executionPromiseDictionary[clonedRoute.id]
    // Check if route is already running
    if (executionPromise) {
      return executionPromise
    }

    executionPromise = this.executeSteps(signer, clonedRoute, settings)

    this.executionPromiseDictionary[clonedRoute.id] = executionPromise

    return executionPromise
  }

  /**
   * Resume the execution of a route that has been stopped or had an error while executing.
   * @param {Signer} signer - The signer required to send the transactions.
   * @param {Route} route - The route that is to be executed. Cannot be an active route.
   * @param {ExecutionSettings} settings - An object containing settings and callbacks.
   * @return {Promise<Route>} The executed route.
   * @throws {LifiError} Throws a LifiError if the execution fails.
   */
  resumeRoute = async (
    signer: Signer,
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    // Deep clone to prevent side effects
    const clonedRoute = structuredClone<Route>(route)

    const execution = this.executionDictionary[clonedRoute.id]

    if (execution) {
      const executionHalted = execution.executors.some(
        (executor) => executor.executionStopped
      )
      if (!executionHalted) {
        // Check if we want to resume route execution in the background
        this.updateRouteExecution(route, {
          executeInBackground: settings?.executeInBackground,
        })
        const executionPromise = this.executionPromiseDictionary[clonedRoute.id]
        return executionPromise ?? clonedRoute
      }
    }
    handlePreRestart(clonedRoute)

    const executionPromise = this.executeSteps(signer, clonedRoute, settings)

    this.executionPromiseDictionary[clonedRoute.id] = executionPromise

    return executionPromise
  }

  private executeSteps = async (
    signer: Signer,
    route: Route,
    settings?: ExecutionSettings
  ): Promise<Route> => {
    const config = this.configService.getConfig()

    const execution: RouteExecutionData = {
      route,
      executors: [],
      settings: { ...config.defaultExecutionSettings, ...settings },
    }

    this.executionDictionary[route.id] = execution

    const statusManager = new StatusManager(
      route,
      execution.settings,
      (route: Route) => {
        if (this.executionDictionary[route.id]) {
          execution.route = route
        }
      }
    )

    // Loop over steps and execute them
    for (let index = 0; index < route.steps.length; index++) {
      const execution = this.executionDictionary[route.id]
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
        const stepExecutor = new StepExecutor(statusManager, execution.settings)
        execution.executors.push(stepExecutor)

        // Check if we want to execute this step in the background
        this.updateRouteExecution(route, execution.settings)

        const executedStep = await stepExecutor.executeStep(signer, step)

        // We may reach this point if user interaction isn't allowed. We want to stop execution until we resume it
        if (executedStep.execution?.status !== 'DONE') {
          this.stopExecution(route)
        }

        // Execution stopped during the current step, we don't want to continue to the next step so we return already
        if (stepExecutor.executionStopped) {
          return route
        }
      } catch (e) {
        this.stopExecution(route)
        throw e
      }
    }

    // Clean up after the execution
    delete this.executionDictionary[route.id]
    return route
  }

  /**
   * Updates route execution to background or foreground state.
   * @param {Route} route - A route that is currently in execution.
   * @param {boolean} settings - An object with execution settings.
   */
  updateRouteExecution = (
    route: Route,
    settings: Pick<ExecutionSettings, 'executeInBackground'>
  ): void => {
    const execution = this.executionDictionary[route.id]
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
   * @param {ExecutionSettings} settings - An object with execution settings.
   * @param {Route} route - The active route that gets the new execution settings.
   * @throws {ValidationError} Throws a ValidationError if parameters are invalid.
   */
  updateExecutionSettings = (
    settings: ExecutionSettings,
    route: Route
  ): void => {
    const execution = this.executionDictionary[route.id]
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
   * Executes a route until a user interaction is necessary (signing transactions, etc.) and then halts until the route is resumed.
   * @param {Route} route - A route that is currently in execution.
   * @deprecated use updateRouteExecution instead.
   */
  moveExecutionToBackground = (route: Route): void => {
    const execution = this.executionDictionary[route.id]
    if (!execution) {
      return
    }

    for (const executor of execution.executors) {
      executor.setInteraction({ allowInteraction: false, allowUpdates: true })
    }
    execution.settings = {
      ...execution.settings,
      executeInBackground: true,
    }
  }

  /**
   * Stops the execution of an active route.
   * @param {Route} route - A route that is currently in execution.
   * @return {Route} The stopped route.
   */
  stopExecution = (route: Route): Route => {
    const execution = this.executionDictionary[route.id]
    if (!execution) {
      return route
    }

    for (const executor of execution.executors) {
      executor.setInteraction({
        allowInteraction: false,
        allowUpdates: false,
        stopExecution: true,
      })
    }
    delete this.executionDictionary[route.id]
    return route
  }

  /**
   * Get the list of active routes.
   * @return {Route[]} A list of routes.
   */
  getActiveRoutes = (): Route[] => {
    return Object.values(this.executionDictionary)
      .map((dict) => dict?.route)
      .filter(Boolean) as Route[]
  }

  /**
   * Return the current route information for given route. The route has to be active.
   * @param {Route} route - A route object.
   * @return {Route} The updated route.
   */
  getActiveRoute = (route: Route): Route | undefined => {
    return this.executionDictionary[route.id]?.route
  }
}
