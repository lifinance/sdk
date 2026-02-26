import type { ChainId, LiFiStep } from '@lifi/types'
import type {
  Execution,
  ExecutionAction,
  ExecutionActionStatus,
  ExecutionActionType,
  LiFiStepExtended,
} from '../types/core.js'
import { getActionMessage } from './actionMessages.js'
import { executionState } from './executionState.js'

type ActionProps = {
  step: LiFiStepExtended
  type: ExecutionActionType
  chainId: ChainId
  status: ExecutionActionStatus
}

/**
 * Manages status updates of a route and provides various functions for tracking actions.
 */
export class StatusManager {
  private readonly routeId: string
  private shouldUpdate = true

  constructor(routeId: string) {
    this.routeId = routeId
  }

  /**
   * Initializes the execution object of a Step.
   * @param step The current step in execution
   * @returns The initialized execution object for this step
   */
  initializeExecution = (step: LiFiStepExtended): Execution => {
    if (!step.execution) {
      step.execution = {
        startedAt: Date.now(),
        status: 'PENDING',
        actions: [],
      }
      this.updateStepInRoute(step)
    }

    // Change status to PENDING after resuming from FAILED
    if (step.execution.status === 'FAILED') {
      step.execution.startedAt = Date.now()
      step.execution.status = 'PENDING'
      step.execution.signedAt = undefined
      this.updateStepInRoute(step)
    }

    return step.execution
  }

  /**
   * Updates the execution object of a Step.
   * @param step The current step in execution
   * @param execution Partial execution data to merge
   * @returns The step with the updated execution object
   */
  updateExecution(
    step: LiFiStepExtended,
    execution: Partial<Execution>
  ): LiFiStep {
    if (!step.execution) {
      throw Error("Can't update empty execution.")
    }
    step.execution = {
      ...step.execution,
      ...execution,
    }
    this.updateStepInRoute(step)
    return step
  }

  /**
   * Finds an action of the specified type in the step's execution
   * @param step The step to search in
   * @param type The action type to find
   * @returns The found action or undefined if not found
   */
  findAction(
    step: LiFiStepExtended,
    type: ExecutionActionType
  ): ExecutionAction | undefined {
    if (!step.execution?.actions) {
      throw new Error("Execution hasn't been initialized.")
    }

    const action = step.execution.actions.find((p) => p.type === type)

    return action
  }

  /**
   * Create and push a new action into the execution.
   * Caller is responsible for ensuring an action of this type does not already exist.
   * @param step The step that should contain the new action.
   * @param type Type of the action.
   * @param chainId Chain Id of the action.
   * @param status The initial status for the new action.
   * @returns The created action.
   */
  createAction = ({
    step,
    type,
    chainId,
    status,
  }: ActionProps): ExecutionAction => {
    if (!step.execution) {
      throw new Error("Execution hasn't been initialized.")
    }

    const newAction: ExecutionAction = {
      type,
      message: getActionMessage(type, status),
      status,
      chainId,
    }

    step.execution.actions.push(newAction)
    step.execution.lastActionType = type
    this.updateStepInRoute(step)
    return newAction
  }

  /**
   * Find an existing action by type and update it, or create a new one if none exists.
   * @param step The step that should contain the action.
   * @param type Type of the action. Used to identify already existing actions.
   * @param chainId Chain Id of the action (used when creating).
   * @param status The status to set on the found or newly created action.
   * @returns The updated or newly created action.
   */
  initializeAction = ({
    step,
    type,
    chainId,
    status,
  }: ActionProps): ExecutionAction => {
    const action = this.findAction(step, type)

    if (action) {
      return this.updateAction(step, type, status)
    }

    return this.createAction({ step, type, chainId, status })
  }

  /**
   * Update an action object.
   * @param step The step where the action should be updated
   * @param type  The action type to update
   * @param status The status the action gets.
   * @param [params] Additional parameters to append to the action.
   * @returns The updated action
   */
  updateAction = (
    step: LiFiStepExtended,
    type: ExecutionActionType,
    status: ExecutionActionStatus,
    params?: Partial<ExecutionAction & { signedAt?: number }>
  ): ExecutionAction => {
    if (!step.execution) {
      throw new Error("Can't update an empty step execution.")
    }
    const currentAction = this.findAction(step, type)

    if (!currentAction) {
      throw new Error("Can't find an action for the given type.")
    }

    switch (status) {
      case 'CANCELLED':
        break
      case 'FAILED':
        step.execution.status = 'FAILED'
        break
      case 'DONE':
        break
      case 'PENDING':
        step.execution.status = 'PENDING'
        if (params?.signedAt) {
          step.execution.signedAt = params.signedAt
        }
        break
      case 'RESET_REQUIRED':
      case 'MESSAGE_REQUIRED':
      case 'ACTION_REQUIRED':
        step.execution.status = 'ACTION_REQUIRED'
        break
      default:
        break
    }

    step.execution.lastActionType = type

    currentAction.status = status
    currentAction.message = getActionMessage(type, status)
    // set extra parameters or overwrite the standard params set in the switch statement
    if (params) {
      const { signedAt: _signedAt, ...rest } = params
      Object.assign(currentAction, rest)
    }
    // Sort actions, the ones with DONE status go first
    step.execution.actions = [
      ...step.execution.actions.filter((action) => action.status === 'DONE'),
      ...step.execution.actions.filter((action) => action.status !== 'DONE'),
    ]
    this.updateStepInRoute(step) // updates the step in the route
    return currentAction
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
