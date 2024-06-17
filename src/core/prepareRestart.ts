import type { LiFiStep } from '@lifi/types'
import type { LiFiStepExtended, RouteExtended } from './types.js'

export const prepareRestart = async (route: RouteExtended) => {
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index]
    const stepHasFailed = step.execution?.status === 'FAILED'

    if (stepHasFailed) {
      deleteFailedProcesses(step)
      deleteTransactionData(step)
    }
  }
}

const deleteFailedProcesses = (step: LiFiStepExtended) => {
  if (step.execution) {
    step.execution.process = step.execution.process.filter(
      (process) => process.status === 'DONE'
    )
  }
}

const deleteTransactionData = (step: LiFiStep) => {
  step.transactionRequest = undefined
}
