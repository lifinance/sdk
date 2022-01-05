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
export class StatusManager {
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
  initExecutionObject = (step: Step) => {
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
   * Reduces a sequence of names to initials.
   * @param  {String} id  Identifier for the process. Used to identify already existing processes.
   * @param  {UpdateExecution} updateExecution   updateExecution The function used to update the step.
   * @param  {Execution} execution The Execution object that the Process is appended to.
   * @param  {ProcessMessage} message  A ProcessMessage for this Process. Will be used on newly created or already existing process.
   * @param  {object} [params]   Additional parameters to append to the process.
   * @return {void}
   */
  createAndPushProcess = (
    id: string,
    updateExecution: (execution: Execution) => void,
    execution: Execution,
    message: ProcessMessage,
    params?: object
  ) => {
    const process = execution.process.find((p) => p.id === id)
    if (process) {
      execution.status = 'PENDING'
      updateExecution(execution)
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

    execution.status = 'PENDING'
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
  setStatusFailed = (
    updateExecution: UpdateExecution,
    execution: Execution,
    currentProcess: Process,
    params?: object
  ) => {
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
   * Set a process to 'DONE'.
   * @param  {UpdateExecution} updateExecution   updateExecution The function used to update the step.
   * @param  {Execution} execution The Execution object to update.
   * @param  {Process} currentProcess  The Process to set to 'FAILED'
   * @param  {object} [params]   Additional parameters to append to the process.
   * @return {void}
   */
  setStatusDone = (
    updateExecution: UpdateExecution,
    execution: Execution,
    currentProcess: Process,
    params?: object
  ) => {
    currentProcess.execution = 'DONE'
    currentProcess.doneAt = Date.now()
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        currentProcess[key] = value
      }
    }
    updateExecution(execution)
  }
}
