/* eslint-disable max-params */
/* eslint-disable @typescript-eslint/ban-types */
import {
  emptyExecution,
  Execution,
  Hooks,
  Process,
  ProcessMessage,
  Route,
  Status,
  Step,
} from './types'
import { deepClone } from './utils'

interface Receipt {
  fromAmount?: string
  toAmount: string
}
/**
 * Manages status updates of a route and provides various functions for tracking processes
 * @param  {Route} route  The route this StatusManger belongs to.
 * @param  {Hooks} settings   The ExecutionSettings for this route
 * @return {StatusManager}       An instance of StatusManager.
 */
export default class StatusManager {
  route: Route
  settings: Hooks

  constructor(route: Route, settings: Hooks) {
    this.route = route
    this.settings = settings
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
    if (!step.execution) throw Error('Can update empty execution')
    step.execution.status = status
    if (receipt) {
      step.execution.fromAmount = receipt.fromAmount
      step.execution.toAmount = receipt.toAmount
    }
    this.updateStepInRoute(step)
    return step
  }

  /**
   * Create and push a new process into the execution. If a process for the given id already exists the existing process is set to PENDING instead.
   * @param  {String} id  Identifier for the process. Used to identify already existing processes.
   * @param  {UpdateExecution} updateExecution   updateExecution The function used to update the step.
   * @param  {Execution} execution The Execution object that the Process is appended to.
   * @param  {ProcessMessage} message  A ProcessMessage for this Process. Will be used on newly created or already existing process.
   * @param  {object} [params]   Additional parameters to append to the process.
   * @return {Process}
   */
  findOrCreateProcess = (
    id: string,
    step: Step,
    execution: Execution,
    message: ProcessMessage,
    params?: object
  ): Process => {
    const process = execution.process.find((p) => p.id === id)

    if (process) {
      return process
    }

    const newProcess: Process = {
      id: id,
      startedAt: Date.now(),
      message: message,
      status: 'PENDING',
    }
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        newProcess[key] = value
      }
    }

    execution.process.push(newProcess)
    step.execution = execution
    this.updateStepInRoute(step)
    return newProcess
  }

  /**
   * Update a process object.
   * @param  {Step} step The TODO
   * @param  {string} processId  The process id to update
   * @param  {Status} status The status the process gets.
   * @param  {object} [params]   Additional parameters to append to the process.
   * @return {Process} The update process
   */
  updateProcess = (
    step: Step,
    processId: string,
    status: Status,
    params?: object
  ): Process => {
    const currentProcess = step?.execution?.process.find(
      (p) => p.id === processId
    )

    if (!currentProcess) {
      throw new Error('TODO')
    }

    switch (status) {
      // terminating
      case 'CANCELLED':
        currentProcess.doneAt = Date.now()
        currentProcess.message =
          'CANCELLED - Funds have been refunded on source chain.'
        break
      case 'FAILED':
        currentProcess.doneAt = Date.now()
        break
      case 'DONE':
        currentProcess.doneAt = Date.now()
        break
      case 'ACTION_REQUIRED':
        currentProcess.message = 'Sign Transaction'
        break
      case 'CHAIN_SWITCH_REQUIRED':
        currentProcess.message = 'Switching Chain'
        break
      case 'PENDING':
        currentProcess.message = 'Wait for'
      default:
        break
    }

    currentProcess.status = status
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
   * @param  {UpdateExecution} updateExecution updateExecution The function used to update the step.
   * @param  {Execution} execution The Execution object to update.
   * @param  {Process} currentProcess  The Process to remove
   * @return {void}
   */
  removeProcess = (
    step: Step,
    execution: Execution,
    currentProcess: Process
  ): void => {
    const index = execution.process.findIndex(
      (process) => process.id === currentProcess.id
    )
    execution.process.splice(index, 1)
    step.execution = execution
    this.updateStepInRoute(step)
  }

  private updateStepInRoute = (step: Step): void => {
    const stepIndex = this.route.steps.findIndex(
      (routeStep) => routeStep.id === step.id
    )

    if (stepIndex === -1) {
      throw new Error('TODO')
    }

    this.route.steps[stepIndex] = Object.assign(
      this.route.steps[stepIndex],
      step
    )

    this.settings.updateCallback(this.route)
  }
}
