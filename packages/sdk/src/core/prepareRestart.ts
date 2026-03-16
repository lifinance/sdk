import type { RouteExtended } from '../types/core.js'

export const prepareRestart = (route: RouteExtended) => {
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index]
    if (step.execution) {
      // Find the index of the last action that has tx hash, taskId, or signed messages
      const lastValidIndex = step.execution.actions.findLastIndex(
        (action) =>
          ['SWAP', 'CROSS_CHAIN', 'RECEIVING_CHAIN'].includes(action.type) &&
          (!!action.txHash || !!action.taskId) &&
          action.status !== 'FAILED'
      )

      // Keep all actions up to the one with tx hash
      if (lastValidIndex >= 0) {
        step.execution.actions = step.execution.actions.slice(
          0,
          lastValidIndex + 1
        )
      } else {
        // If no tx hash exists, reset the actions array
        step.execution.actions = []
      }
    }
    step.transactionRequest = undefined
  }
}
