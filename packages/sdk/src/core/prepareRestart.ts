import type { RouteExtended } from '../types/core.js'

export const prepareRestart = (route: RouteExtended) => {
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index]
    if (step.execution) {
      // Keep only done transactions
      step.execution.transactions = step.execution.transactions.filter(
        (tx) => tx.isDone
      )
    }
    step.transactionRequest = undefined
  }
}
