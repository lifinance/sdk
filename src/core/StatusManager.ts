import type {
  ChainId,
  Execution,
  ExecutionStatus,
  LiFiStep,
  Process,
  ProcessStatus,
  ProcessType,
} from '@lifi/types'
import { executionState } from './executionState.js'
import { getProcessMessage } from './processMessages.js'
import type { LiFiStepExtended } from './types.js'

export type FindOrCreateProcessProps = {
  step: LiFiStepExtended
  type: ProcessType
  chainId?: ChainId
  status?: ProcessStatus
}

/**
 * Manages status updates of a route and provides various functions for tracking processes
 * @param {string} routeId The route dd this StatusManger belongs to.
 * @returns {StatusManager} An instance of StatusManager.
 */
export class StatusManager {
  private readonly routeId: string
  private shouldUpdate = true

  constructor(routeId: string) {
    this.routeId = routeId
  }

  /**
   * Initializes the execution object of a Step.
   * @param step  The current step in execution
   * @returns The initialized execution object for this step and a function to update this step
   */
  initExecutionObject = (step: LiFiStepExtended): Execution => {
    if (!step.execution) {
      step.execution = {
        status: 'PENDING',
        process: [],
      }
      this.updateStepInRoute(step)
    }

    // Change status to PENDING after resuming from FAILED
    if (step.execution.status === 'FAILED') {
      step.execution.status = 'PENDING'
      this.updateStepInRoute(step)
    }

    return step.execution
  }

  /**
   * Updates the execution object of a Step.
   * @param step  The current step in execution
   * @param status  The status for the execution
   * @param execution Optional. Information about received tokens
   * @returns The step with the updated execution object
   */
  updateExecution(
    step: LiFiStepExtended,
    status: ExecutionStatus,
    execution?: Partial<Execution>
  ): LiFiStep {
    if (!step.execution) {
      throw Error("Can't update empty execution.")
    }
    step.execution.status = status
    if (execution) {
      step.execution = {
        ...step.execution,
        ...execution,
      }
    }
    this.updateStepInRoute(step)
    return step
  }

  /**
   * Create and push a new process into the execution.
   * @param step.step The step that should contain the new process.
   * @param step.type Type of the process. Used to identify already existing processes.
   * @param step.chainId Chain Id of the process.
   * @param step.status By default created procces is set to the STARTED status. We can override new process with the needed status.
   * @param root0
   * @param root0.step
   * @param root0.type
   * @param root0.chainId
   * @param root0.status
   * @returns Returns process.
   */
  findOrCreateProcess = ({
    step,
    type,
    chainId,
    status,
  }: FindOrCreateProcessProps): Process => {
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
      chainId: chainId,
    }

    step.execution.process.push(newProcess)
    this.updateStepInRoute(step)
    return newProcess
  }

  /**
   * Update a process object.
   * @param step The step where the process should be updated
   * @param type  The process type to update
   * @param status The status the process gets.
   * @param [params] Additional parameters to append to the process.
   * @returns The update process
   */
  updateProcess = (
    step: LiFiStepExtended,
    type: ProcessType,
    status: ProcessStatus,
    params?: Partial<Process>
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
      ...step.execution.process.filter((process) => process.status === 'DONE'),
      ...step.execution.process.filter((process) => process.status !== 'DONE'),
    ]
    this.updateStepInRoute(step) // updates the step in the route
    return currentProcess
  }

  /**
   * Remove a process from the execution
   * @param step The step where the process should be removed from
   * @param type  The process type to remove
   */
  removeProcess = (step: LiFiStepExtended, type: ProcessType): void => {
    if (!step.execution) {
      throw new Error("Execution hasn't been initialized.")
    }
    const index = step.execution.process.findIndex((p) => p.type === type)
    step.execution.process.splice(index, 1)
    this.updateStepInRoute(step)
  }

  updateStepInRoute = (step: LiFiStep): LiFiStep => {
    if (!this.shouldUpdate) {
      return step
    }
    const data = executionState.get(this.routeId)

    if (!data) {
      throw new Error('Execution data not found.')
    }

    const stepIndex = data.route.steps.findIndex(
      (routeStep) => routeStep.id === step.id
    )

    if (stepIndex === -1) {
      throw new Error("Couldn't find a step to update.")
    }

    data.route.steps[stepIndex] = { ...data.route.steps[stepIndex], ...step }

    data.executionOptions?.updateRouteHook?.(data.route)
    return data.route.steps[stepIndex]
  }

  allowUpdates(value: boolean): void {
    this.shouldUpdate = value
  }
}
