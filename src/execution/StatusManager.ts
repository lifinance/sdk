import {
  emptyExecution,
  Execution,
  InternalExecutionSettings,
  Process,
  ProcessType,
  Route,
  Status,
  Step,
  Token,
} from '../types'
import { deepClone } from '../utils/utils'
import { getProcessMessage } from './utils'

interface Receipt {
  fromAmount?: string
  toAmount?: string
  toToken?: Token
}

type InternalUpdateRouteCallback = (route: Route) => void

type OptionalParameters = Partial<
  Pick<
    Process,
    | 'doneAt'
    | 'failedAt'
    | 'txHash'
    | 'txLink'
    | 'error'
    | 'substatus'
    | 'substatusMessage'
  >
>

/**
 * Manages status updates of a route and provides various functions for tracking processes
 * @param  {Route} route  The route this StatusManger belongs to.
 * @param  {InternalExecutionSettings} settings   The ExecutionSettings for this route.
 * @param  {InternalUpdateRouteCallback} internalUpdateRouteCallback  Internal callback to propage route changes.
 * @return {StatusManager}       An instance of StatusManager.
 */
export class StatusManager {
  private readonly route: Route
  private readonly settings: InternalExecutionSettings
  private readonly internalUpdateRouteCallback: InternalUpdateRouteCallback
  private shouldUpdate = true

  constructor(
    route: Route,
    settings: InternalExecutionSettings,
    internalUpdateRouteCallback: InternalUpdateRouteCallback
  ) {
    this.route = route
    this.settings = settings
    this.internalUpdateRouteCallback = internalUpdateRouteCallback
  }

  /**
   * Initializes the execution object of a Step.
   * @param  {Step} step  The current step in execution
   * @return {Execution}       The initialized execution object for this step and a function to update this step
   */
  initExecutionObject = (step: Step): Execution => {
    const currentExecution =
      step.execution || (deepClone(emptyExecution) as Execution)

    if (!step.execution) {
      step.execution = currentExecution
      this.updateStepInRoute(step)
    }
    return currentExecution
  }

  /**
   * Updates the execution object of a Step.
   * @param  {Step} step  The current step in execution
   * @param  {Status} status  The status for the execution
   * @param  {Receipt} receipt Optional. Information about received tokens
   * @return {Step}       The step with the updated execution object
   */
  updateExecution(step: Step, status: Status, receipt?: Receipt): Step {
    if (!step.execution) {
      throw Error("Can't update empty execution.")
    }
    step.execution.status = status
    if (receipt) {
      step.execution.fromAmount = receipt.fromAmount
      step.execution.toAmount = receipt.toAmount
      step.execution.toToken = receipt.toToken
    }
    this.updateStepInRoute(step)
    return step
  }

  /**
   * Create and push a new process into the execution.
   * @param  {ProcessType} type Type of the process. Used to identify already existing processes.
   * @param  {Step} step The step that should contain the new process.
   * @param  {Status} status By default created procces is set to the STARTED status. We can override new process with the needed status.
   * @return {Process}
   */
  findOrCreateProcess = (
    type: ProcessType,
    step: Step,
    status?: Status
  ): Process => {
    if (!step.execution || !step.execution.process) {
      throw new Error("Execution hasn't been initialized.")
    }

    const process = step.execution.process.find((p) => p.type === type)

    if (process) {
      return process
    }

    const newProcess: Process = {
      type: type,
      startedAt: Date.now(),
      message: getProcessMessage(type, status ?? 'STARTED'),
      status: status ?? 'STARTED',
    }

    step.execution.process.push(newProcess)
    this.updateStepInRoute(step)
    return newProcess
  }

  /**
   * Update a process object.
   * @param  {Step} step The step where the process should be updated
   * @param  {ProcessType} type  The process type to update
   * @param  {Status} status The status the process gets.
   * @param  {object} [params]   Additional parameters to append to the process.
   * @return {Process} The update process
   */
  updateProcess = (
    step: Step,
    type: ProcessType,
    status: Status,
    params?: OptionalParameters
  ): Process => {
    const currentProcess = step?.execution?.process.find((p) => p.type === type)

    if (!currentProcess) {
      throw new Error("Can't find a process for the given type.")
    }

    switch (status) {
      case 'CANCELLED':
        currentProcess.doneAt = Date.now()
        break
      case 'FAILED':
        currentProcess.doneAt = Date.now()
        break
      case 'DONE':
        currentProcess.doneAt = Date.now()
        break
      default:
        break
    }

    currentProcess.status = status
    currentProcess.message = getProcessMessage(type, status)
    // set extra parameters or overwritte the standard params set in the switch statement
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        currentProcess[key] = value
      }
    }
    this.updateStepInRoute(step) // updates the step in the route
    return currentProcess
  }

  /**
   * Remove a process from the execution
   * @param  {Step} step The step where the process should be removed from
   * @param  {ProcessType} type  The process type to remove
   * @return {void}
   */
  removeProcess = (step: Step, type: ProcessType): void => {
    if (!step.execution) {
      throw new Error("Execution hasn't been initialized.")
    }
    const index = step.execution.process.findIndex((p) => p.type === type)
    step.execution.process.splice(index, 1)
    this.updateStepInRoute(step)
  }

  private updateStepInRoute = (step: Step): void => {
    if (!this.shouldUpdate) {
      return
    }

    const stepIndex = this.route.steps.findIndex(
      (routeStep) => routeStep.id === step.id
    )

    if (stepIndex === -1) {
      throw new Error("Couldn't find a step to update.")
    }

    this.route.steps[stepIndex] = Object.assign(
      this.route.steps[stepIndex],
      step
    )

    this.settings.updateCallback(this.route)
    this.internalUpdateRouteCallback(this.route)
  }

  setShouldUpdate(value: boolean): void {
    this.shouldUpdate = value
  }
}
