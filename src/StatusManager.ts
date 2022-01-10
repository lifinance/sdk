/* eslint-disable max-params */
/* eslint-disable @typescript-eslint/ban-types */
import {
  emptyExecution,
  Execution,
  Hooks,
  Process,
  ProcessMessage,
  Route,
  Step,
  UpdateExecution,
} from './types'
import { deepClone } from './utils'
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
   * @return {Execution, UpdateExecution}       The initialized execution object for this step and a function to update this step
   */
  initExecutionObject = (
    step: Step
  ): { currentExecution: Execution; updateExecution: UpdateExecution } => {
    const currentExecution =
      step.execution || (deepClone(emptyExecution) as Execution)

    const updateExecution = (newExecution: Execution) => {
      step.execution = newExecution
      this.settings.updateCallback(this.route)
    }

    if (!step.execution) {
      updateExecution(currentExecution)
    }
    return { currentExecution, updateExecution }
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
    updateExecution: (execution: Execution) => void,
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
    updateExecution(execution)
    return newProcess
  }

  /**
   * Set a process to 'FAILED'.
   * @param  {UpdateExecution} updateExecution   updateExecution The function used to update the step.
   * @param  {Execution} execution The Execution object to update.
   * @param  {Process} currentProcess  The Process to set to 'FAILED'
   * @param  {object} [params]   Additional parameters to append to the process.
   * @return {void}
   */
  setProcessFailed = (
    updateExecution: UpdateExecution,
    execution: Execution,
    currentProcess: Process,
    params?: object
  ): void => {
    execution.status = 'FAILED'
    currentProcess.status = 'FAILED'
    currentProcess.failedAt = Date.now()
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        currentProcess[key] = value
      }
    }

    updateExecution(execution)
  }

  /**
   * Remove a process from the execution
   * @param  {UpdateExecution} updateExecution updateExecution The function used to update the step.
   * @param  {Execution} execution The Execution object to update.
   * @param  {Process} currentProcess  The Process to remove
   * @return {void}
   */
  removeProcess = (
    updateExecution: UpdateExecution,
    execution: Execution,
    currentProcess: Process
  ): void => {
    const index = execution.process.findIndex(
      (process) => process.id === currentProcess.id
    )
    execution.process.splice(index, 1)
    updateExecution(execution)
  }

  /**
   * Set a process to 'DONE'.
   * @param  {UpdateExecution} updateExecution   updateExecution The function used to update the step.
   * @param  {Execution} execution The Execution object to update.
   * @param  {Process} currentProcess  The Process to set to 'FAILED'
   * @param  {object} [params]   Additional parameters to append to the process.
   * @return {void}
   */
  setProcessDone = (
    updateExecution: UpdateExecution,
    execution: Execution,
    currentProcess: Process,
    params?: object
  ): void => {
    currentProcess.status = 'DONE'
    currentProcess.doneAt = Date.now()
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        currentProcess[key] = value
      }
    }

    updateExecution(execution)
  }

  /**
   * Set a process to 'CANCELLED'.
   * @param  {UpdateExecution} updateExecution   updateExecution The function used to update the step.
   * @param  {Execution} execution The Execution object to update.
   * @param  {Process} currentProcess  The Process to set to 'FAILED'
   * @param  {object} [params]   Additional parameters to append to the process.
   * @return {void}
   */
  setProcessCancelled = (
    updateExecution: UpdateExecution,
    execution: Execution,
    currentProcess: Process,
    params?: object
  ): void => {
    currentProcess.status = 'CANCELLED'
    currentProcess.doneAt = Date.now()
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        currentProcess[key] = value
      }
    }
    updateExecution(execution)
  }
}
