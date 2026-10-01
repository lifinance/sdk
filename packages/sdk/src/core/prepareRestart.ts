import type { ExecutionActionType, RouteExtended } from '../types/core.js'
import { getActionMessage } from './actionMessages.js'
import { hasOpenTransaction } from './transactionState.js'

const RESTART_ACTION_TYPES: readonly ExecutionActionType[] = [
  'SWAP',
  'CROSS_CHAIN',
  'RECEIVING_CHAIN',
]

export const prepareRestart = (route: RouteExtended): void => {
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index]
    if (step.execution) {
      // Keep everything up to the last action whose transaction may still
      // land. A FAILED action without `txFinal` has an unknown outcome: it is
      // kept and re-checked on chain instead of being signed again. A FAILED
      // action with `txFinal` is dropped, so the restart signs a new one.
      const lastOpenIndex = step.execution.actions.findLastIndex(
        (action) =>
          RESTART_ACTION_TYPES.includes(action.type) &&
          hasOpenTransaction(action)
      )

      if (lastOpenIndex >= 0) {
        step.execution.actions = step.execution.actions
          .slice(0, lastOpenIndex + 1)
          .map((action) =>
            action.status === 'FAILED' && hasOpenTransaction(action)
              ? {
                  ...action,
                  status: 'PENDING',
                  message: getActionMessage(action.type, 'PENDING'),
                  error: undefined,
                }
              : action
          )
      } else {
        step.execution.actions = []
      }
    }
    step.transactionRequest = undefined
  }
}
