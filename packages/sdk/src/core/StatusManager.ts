import type { ChainId, LiFiStep } from '@lifi/types'
import type {
  Execution,
  ExecutionAction,
  ExecutionActionStatus,
  ExecutionActionType,
  LiFiStepExtended,
  RouteExtended,
  UpdateRouteHook,
} from '../types/core.js'
import { getActionMessage } from './actionMessages.js'
import { executionState } from './executionState.js'
import {
  CLEARED_TRANSACTION_FIELDS,
  hasOpenTransaction,
  hasStepOpenTransaction,
  TRANSACTION_ACTION_TYPES,
} from './transactionState.js'

type ActionProps = {
  step: LiFiStepExtended
  type: ExecutionActionType
  chainId: ChainId
  status: ExecutionActionStatus
}

/**
 * The route and hook of an execution that `stopRouteExecution` ended. A task
 * that was still running (e.g. waiting in the wallet prompt) writes its
 * transaction data later; without these the write would never reach the
 * integrator, and a resume of the stored route would sign again.
 * `startCount` is `executionState.startCount` at the stop.
 */
type StoppedExecution = {
  route: RouteExtended
  updateRouteHook?: UpdateRouteHook
  startCount: number
}

/**
 * A write is transaction data when it changes one of these fields. `txLink`
 * and `signedAt` travel with such a write but never trigger one: the status
 * poll rewrites `txLink` every few seconds.
 */
const TRANSACTION_KEYS = ['txHash', 'txHex', 'taskId', 'txFinal'] as const

type TransactionFields = Pick<
  ExecutionAction,
  (typeof TRANSACTION_KEYS)[number]
>

const readTransaction = (action: ExecutionAction): TransactionFields => ({
  txHash: action.txHash,
  txHex: action.txHex,
  taskId: action.taskId,
  txFinal: action.txFinal,
})

/** True when the write changed a transaction field, also to `undefined`. */
const changesTransaction = (
  before: TransactionFields,
  action: ExecutionAction
): boolean => TRANSACTION_KEYS.some((key) => action[key] !== before[key])

/**
 * Copies a late transaction into the route of a newer execution of the same
 * route id, running or ended. The step's objects are changed in place: a
 * running executor holds them, so its selector and its pre-sign guard see
 * the transaction. Returns true when something changed.
 */
const mergeLateTransaction = (
  liveRoute: RouteExtended,
  lateStep: LiFiStepExtended,
  lateAction: ExecutionAction
): boolean => {
  // Cleared or final: the newer execution needs nothing from it.
  if (!hasOpenTransaction(lateAction)) {
    return false
  }
  const liveStep = liveRoute.steps.find(
    (routeStep) => routeStep.id === lateStep.id
  )
  if (!liveStep) {
    return false
  }
  if (!liveStep.execution) {
    liveStep.execution = {
      startedAt: Date.now(),
      status: 'PENDING',
      actions: [structuredClone(lateAction)],
    }
  } else {
    const liveAction = liveStep.execution.actions.find(
      (action) => action.type === lateAction.type
    )
    if (!liveAction) {
      liveStep.execution.actions.push(structuredClone(lateAction))
    } else if (hasOpenTransaction(liveAction)) {
      // The live action already has an open transaction (its own, or one
      // merged earlier); it is kept.
      return false
    } else {
      // All five fields, so a stale `txFinal` goes and the action is open.
      // `txType` goes with them: the live one described no open transaction.
      Object.assign(liveAction, {
        txHash: lateAction.txHash,
        txLink: lateAction.txLink,
        txHex: lateAction.txHex,
        txFinal: lateAction.txFinal,
        taskId: lateAction.taskId,
        txType: lateAction.txType,
      })
    }
  }
  // `signedAt` is the signing time of the step's own transaction: an
  // allowance does not set it, and a write without one keeps the live time.
  const signedAt = lateStep.execution?.signedAt
  if (
    TRANSACTION_ACTION_TYPES.includes(lateAction.type) &&
    signedAt !== undefined
  ) {
    liveStep.execution.signedAt = signedAt
  }
  return true
}

/**
 * Manages status updates of a route and provides various functions for tracking actions.
 */
export class StatusManager {
  private readonly routeId: string
  private shouldUpdate = true
  private stoppedExecution?: StoppedExecution

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
      // Keep the signing time while a signed transaction may still land: the
      // resume path uses it to decide when stored bytes are too old to resend
      // or old enough to be declared dropped.
      if (!hasStepOpenTransaction(step)) {
        step.execution.signedAt = undefined
      }
      step.execution.error = undefined
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
      return this.updateAction(step, type, status, {
        error: undefined,
        // A final outcome is dead. A new attempt starts without its data, so
        // the pre-sign guard does not mistake it for an open transaction (the
        // route was run again without `prepareRestart`, e.g. `executeRoute`).
        ...(action.status === 'FAILED' &&
          action.txFinal === true &&
          CLEARED_TRANSACTION_FIELDS),
      })
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
    // Read before the write: after a stop, only a write that changes the
    // transaction reaches the integrator.
    const transactionBefore = this.shouldUpdate
      ? undefined
      : readTransaction(currentAction)

    switch (status) {
      case 'CANCELLED':
        break
      case 'FAILED':
        step.execution.status = 'FAILED'
        if (params?.error) {
          step.execution.error = params.error
        }
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
      const { signedAt: _signedAt, ...rest } = params
      Object.assign(currentAction, rest)
    }
    // Sort actions, the ones with DONE status go first
    step.execution.actions = [
      ...step.execution.actions.filter((action) => action.status === 'DONE'),
      ...step.execution.actions.filter((action) => action.status !== 'DONE'),
    ]
    if (
      transactionBefore &&
      changesTransaction(transactionBefore, currentAction)
    ) {
      this.deliverLateTransactionData(step, currentAction)
    } else {
      this.updateStepInRoute(step) // updates the step in the route
    }
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

    // A shallow copy on purpose: the route's step must keep sharing the
    // step's `execution` object. `mergeLateTransaction` changes the live
    // route in place, and the running sign task's check after the wallet
    // must see the merge (pinned by the stop-and-resume race test in
    // `sdk-provider-ethereum/src/core/flows/reload.unit.spec.ts`).
    data.route.steps[stepIndex] = { ...data.route.steps[stepIndex], ...step }

    data.executionOptions?.updateRouteHook?.(data.route)
    return data.route.steps[stepIndex]
  }

  allowUpdates(value: boolean): void {
    this.shouldUpdate = value
    if (value) {
      this.stoppedExecution = undefined
      return
    }
    // `stopRouteExecution` turns updates off right before it deletes the
    // execution state, so the state is still here to keep.
    const data = executionState.get(this.routeId)
    if (data) {
      this.stoppedExecution = {
        route: data.route,
        updateRouteHook: data.executionOptions?.updateRouteHook,
        startCount: executionState.startCount(this.routeId),
      }
    }
  }

  /**
   * A write of transaction data after `stopRouteExecution`. With a newer
   * execution of the same route id running, the transaction is merged into
   * it. If no execution of the route started since the stop, the kept route
   * is updated and the kept hook is called. If a newer execution started and
   * ended since the stop, the transaction is merged into the route of the
   * last ended execution, and its hook is called.
   */
  private deliverLateTransactionData(
    step: LiFiStepExtended,
    lateAction: ExecutionAction
  ): void {
    const stopped = this.stoppedExecution
    if (!stopped) {
      return
    }
    // A late write must never fail the task that made it: its catch block
    // would mark the action FAILED while the transaction may still land.
    try {
      // Always a newer execution: `stopRouteExecution` deleted this one.
      const live = executionState.get(this.routeId)
      if (live) {
        if (mergeLateTransaction(live.route, step, lateAction)) {
          live.executionOptions?.updateRouteHook?.(live.route)
        }
        return
      }
      // A newer execution started and ended since the stop: the integrator
      // stored its route, which the kept one would roll back. The late
      // transaction goes into that route instead. With the records of the
      // route freed (no run in flight, `startCount` 0) the write is dropped.
      if (executionState.startCount(this.routeId) !== stopped.startCount) {
        const ended = executionState.lastEnded(this.routeId)
        if (ended && mergeLateTransaction(ended.route, step, lateAction)) {
          ended.updateRouteHook?.(ended.route)
        }
        return
      }
      const stepIndex = stopped.route.steps.findIndex(
        (routeStep) => routeStep.id === step.id
      )
      if (stepIndex === -1) {
        return
      }
      stopped.route.steps[stepIndex] = {
        ...stopped.route.steps[stepIndex],
        ...step,
      }
      stopped.updateRouteHook?.(stopped.route)
    } catch {
      // Ignored on purpose, see above.
    }
  }
}
