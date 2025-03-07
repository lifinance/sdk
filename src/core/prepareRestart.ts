import type { RouteExtended } from './types.js'

export const prepareRestart = async (route: RouteExtended) => {
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index]
    if (step.execution) {
      step.execution.process = step.execution.process.filter(
        (process) => process.status === 'DONE' && process.txHash
      )
    }
    step.transactionRequest = undefined
  }
}
