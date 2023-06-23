import {
  emptyExecution,
  Execution,
  InternalExecutionSettings,
  LifiStep,
  Process,
  ProcessType,
  Route,
  Status,
  Token,
} from '../types'
import { getProcessMessage } from './utils'

interface Receipt {
  fromAmount?: string
  toAmount?: string
  toToken?: Token
  gasPrice?: string
  gasUsed?: string
  gasToken?: Token
  gasAmount?: string
  gasAmountUSD?: string
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
    | 'multisigInternalTxHash'
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
   * @param  {LifiStep} step  The current step in execution
   * @return {Execution}       The initialized execution object for this step and a function to update this step
   */
  initExecutionObject = (step: LifiStep): Execution => {
    const currentExecution =
      step.execution || structuredClone<Execution>(emptyExecution)

    if (!step.execution) {
      step.execution = currentExecution
      step.execution.status = 'PENDING'
      this.updateStepInRoute(step)
    }

    // Change status to PENDING after resuming from FAILED
    if (currentExecution.status === 'FAILED') {
      currentExecution.status = 'PENDING'
      this.updateStepInRoute(step)
    }

    return currentExecution
  }

  /**
   * Updates the execution object of a Step.
   * @param  {LifiStep} step  The current step in execution
   * @param  {Status} status  The status for the execution
   * @param  {Receipt} receipt Optional. Information about received tokens
   * @return {Step}       The step with the updated execution object
   */
  updateExecution(step: LifiStep, status: Status, receipt?: Receipt): LifiStep {
    if (!step.execution) {
      throw Error("Can't update empty execution.")
    }
    step.execution.status = status
    if (receipt) {
      step.execution = {
        ...step.execution,
        ...receipt,
      }
    }
    this.updateStepInRoute(step)
    return step
  }

  /**
   * Create and push a new process into the execution.
   * @param  {ProcessType} type Type of the process. Used to identify already existing processes.
   * @param  {LifiStep} step The step that should contain the new process.
   * @param  {Status} status By default created procces is set to the STARTED status. We can override new process with the needed status.
   * @return {Process}
   */
  findOrCreateProcess = (
    step: LifiStep,
    type: ProcessType,
    status?: Status
  ): Process => {
    if (!step.execution?.process) {
      throw new Error("Execution hasn't been initialized.")
    }

    const process = step.execution.process.find((p) => p.type === type)

    if (process) {
      if (status && process.status !== status) {
        process.status = status
        this.updateStepInRoute(step)
      }
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
   * @param  {LifiStep} step The step where the process should be updated
   * @param  {ProcessType} type  The process type to update
   * @param  {Status} status The status the process gets.
   * @param  {object} [params]   Additional parameters to append to the process.
   * @return {Process} The update process
   */
  updateProcess = (
    step: LifiStep,
    type: ProcessType,
    status: Status,
    params?: OptionalParameters
  ): Process => {
    if (!step.execution) {
      throw new Error("Can't update an empty step execution.")
    }
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
        step.execution.status = 'FAILED'
        break
      case 'DONE':
        currentProcess.doneAt = Date.now()
        break
      case 'PENDING':
        step.execution.status = 'PENDING'
        break
      case 'ACTION_REQUIRED':
        step.execution.status = 'ACTION_REQUIRED'
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
    // Sort processes, the ones with DONE status go first
    step.execution.process = [
      ...step?.execution?.process.filter(
        (process) => process.status === 'DONE'
      ),
      ...step?.execution?.process.filter(
        (process) => process.status !== 'DONE'
      ),
    ]
    this.updateStepInRoute(step) // updates the step in the route
    return currentProcess
  }

  /**
   * Remove a process from the execution
   * @param  {LifiStep} step The step where the process should be removed from
   * @param  {ProcessType} type  The process type to remove
   * @return {void}
   */
  removeProcess = (step: LifiStep, type: ProcessType): void => {
    if (!step.execution) {
      throw new Error("Execution hasn't been initialized.")
    }
    const index = step.execution.process.findIndex((p) => p.type === type)
    step.execution.process.splice(index, 1)
    this.updateStepInRoute(step)
  }

  updateStepInRoute = (step: LifiStep): LifiStep => {
    if (!this.shouldUpdate) {
      return step
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

    this.settings.updateRouteHook(this.route)
    this.internalUpdateRouteCallback(this.route)
    return this.route.steps[stepIndex]
  }

  allowUpdates(value: boolean): void {
    this.shouldUpdate = value
  }
}
