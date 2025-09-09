import type { RouteExtended } from './types.js'

export const prepareRestart = (route: RouteExtended) => {
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index]
    if (step.execution) {
      // Find the index of the last process that has tx hash, taskId, or signed messages
      const lastValidIndex = step.execution.process.findLastIndex(
        (process) =>
          (!!process.txHash ||
            !!process.taskId ||
            !!process.signedTypedData?.length) &&
          process.status !== 'FAILED'
      )

      // Keep all processes up to the one with tx hash
      if (lastValidIndex >= 0) {
        step.execution.process = step.execution.process.slice(
          0,
          lastValidIndex + 1
        )
      } else {
        // If no tx hash exists, reset the process array
        step.execution.process = []
      }
    }
    step.transactionRequest = undefined
  }
}
