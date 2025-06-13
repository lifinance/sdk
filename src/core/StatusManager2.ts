import type { ChainId, LiFiStep } from '@lifi/types'
import { executionState } from './executionState.js'
import { NewExecution, NewProcess } from './fsm.js'
import type {
  ExecutionStatus,
  LiFiStepExtended,
  ProcessStatus,
  ProcessType,
} from './types.js'

export type FindOrCreateProcessProps = {
  step: LiFiStepExtended
  type: ProcessType
  chainId?: ChainId
  status?: ProcessStatus
  startedAt?: number
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
  initExecutionObject = (step: LiFiStepExtended): NewExecution => {
    if (!step.execution) {
      step.execution = new NewExecution()
    }

    // Change status to PENDING after resuming from FAILED
    if (['IDLE', 'FAILED'].includes(step.execution.status)) {
      step.execution.transition('PENDING')
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
    execution?: Partial<NewExecution>
  ): LiFiStep {
    if (!step.execution) {
      throw Error("Can't update empty execution.")
    }
    step.execution.transition(status)
    if (execution) {
      step.execution.update(execution)
    }
    this.updateStepInRoute(step)
    return step
  }

  /**
   * Finds a process of the specified type in the step's execution
   * @param step The step to search in
   * @param type The process type to find
   * @param status Optional status to update the process with if found
   * @returns The found process or undefined if not found
   */
  findProcess(
    step: LiFiStepExtended,
    type: ProcessType
  ): NewProcess | undefined {
    if (!step.execution?.process) {
      throw new Error("Execution hasn't been initialized.")
    }

    return step.execution.process.find((p) => p.type === type)
  }

  /**
   * Create and push a new process into the execution.
   * @param step The step that should contain the new process.
   * @param type Type of the process. Used to identify already existing processes.
   * @param chainId Chain Id of the process.
   * @param status By default created process is set to the STARTED status. We can override new process with the needed status.
   * @returns Returns process.
   */
  findOrCreateProcess = ({
    step,
    type,
    chainId,
    status,
    startedAt,
  }: FindOrCreateProcessProps): NewProcess => {
    const process = this.findProcess(step, type)
    if (process) {
      return process
    }

    const newProcess = new NewProcess(type, status, chainId, startedAt)
    step.execution!.process.push(newProcess)
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
    params?: Partial<NewProcess>
  ): NewProcess => {
    if (!step.execution) {
      throw new Error("Can't update an empty step execution.")
    }
    const currentProcess = this.findProcess(step, type)

    if (!currentProcess) {
      throw new Error("Can't find a process for the given type.")
    }

    currentProcess.transition(status)
    if (['FAILED', 'PENDING', 'ACTION_REQUIRED'].includes(status)) {
      step.execution.transition(status as ExecutionStatus)
    }

    // set extra parameters or overwritten the standard params set in the switch statement
    if (params) {
      currentProcess.update(params)
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
