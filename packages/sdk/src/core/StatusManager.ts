import type { ChainId, LiFiStep } from '@lifi/types'
import type {
  Execution,
  ExecutionAction,
  ExecutionActionStatus,
  ExecutionActionType,
  ExecutionStatus,
  LiFiStepExtended,
} from '../types/core.js'
import { getActionMessage } from './actionMessages.js'
import { executionState } from './executionState.js'

type FindOrCreateActionProps = {
  step: LiFiStepExtended
  type: ExecutionActionType
  chainId?: ChainId
  status?: ExecutionActionStatus
}

/**
 * Manages status updates of a route and provides various functions for tracking actions
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
   * Finds an action of the specified type in the step's execution
   * @param step The step to search in
   * @param type The action type to find
   * @param status Optional status to update the action with if found
   * @returns The found action or undefined if not found
   */
  findAction(
    step: LiFiStepExtended,
    type: ExecutionActionType,
    status?: ExecutionActionStatus
  ): ExecutionAction | undefined {
    if (!step.execution?.actions) {
      throw new Error("Execution hasn't been initialized.")
    }

    const action = step.execution.actions.find((p) => p.type === type)

    if (action && status && action.status !== status) {
      action.status = status
      this.updateStepInRoute(step)
    }

    return action
  }

  /**
   * Create and push a new action into the execution.
   * Caller is responsible for ensuring an action of this type does not already exist (e.g. after findAction returned undefined).
   * @param step The step that should contain the new action.
   * @param type Type of the action.
   * @param chainId Chain Id of the action.
   * @param status By default created action is set to the STARTED status. We can override new action with the needed status.
   * @returns The created action.
   */
  createAction = ({
    step,
    type,
    chainId,
    status,
  }: FindOrCreateActionProps): ExecutionAction => {
    const newAction: ExecutionAction = {
      type: type,
      message: getActionMessage(type, status ?? 'STARTED'),
      status: status ?? 'STARTED',
      chainId: chainId,
    }

    step.execution!.actions.push(newAction)
    this.updateStepInRoute(step)
    return newAction
  }

  /**
   * Find an existing action by type, or create and push a new one if none exists.
   * @param step The step that should contain the action.
   * @param type Type of the action. Used to identify already existing actions.
   * @param chainId Chain Id of the action (used when creating).
   * @param status By default created action is set to the STARTED status. We can override new action with the needed status.
   * @returns The found or newly created action.
   */
  findOrCreateAction = ({
    step,
    type,
    chainId,
    status,
  }: FindOrCreateActionProps): ExecutionAction => {
    const action = this.findAction(step, type, status)
    if (action) {
      return action
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
    params?: Partial<ExecutionAction>
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

    currentAction.status = status
    currentAction.message = getActionMessage(type, status)
    // set extra parameters or overwrite the standard params set in the switch statement
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        currentAction[key] = value
      }
    }
    // Sort actions, the ones with DONE status go first
    step.execution.actions = [
      ...step.execution.actions.filter((action) => action.status === 'DONE'),
      ...step.execution.actions.filter((action) => action.status !== 'DONE'),
    ]
    this.updateStepInRoute(step) // updates the step in the route
    return currentAction
  }

  /**
   * Remove an action from the execution
   * @param step The step where the action should be removed from
   * @param type  The action type to remove
   */
  removeAction = (step: LiFiStepExtended, type: ExecutionActionType): void => {
    if (!step.execution) {
      throw new Error("Execution hasn't been initialized.")
    }
    const index = step.execution.actions.findIndex((p) => p.type === type)
    step.execution.actions.splice(index, 1)
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
