import type { RouteExtended } from '../types/core.js'

export const prepareRestart = (route: RouteExtended) => {
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index]
    if (step.execution) {
      // Find the index of the last transaction that has tx hash or taskId
      const lastValidIndex = step.execution.actions.findLastIndex(
        (transaction) =>
          (!!transaction.txHash || !!transaction.taskId) &&
          step.execution?.status !== 'FAILED'
      )

      // Keep all transactions up to the one with tx hash
      if (lastValidIndex >= 0) {
        step.execution.actions = step.execution.actions.slice(
          0,
          lastValidIndex + 1
        )
      } else {
        // If no tx hash exists, reset the transactions array
        step.execution.actions = []
      }
    }
    step.transactionRequest = undefined
  }
}
