import type { Execution, RouteExtended } from '@lifi/sdk'

export const reportStepsExecutionToTerminal = (updatedRoute: RouteExtended) => {
  const lastExecution = updatedRoute.steps.reduce(
    (_accum, step) => {
      if (step.execution) {
        return step.execution
      }
    },
    undefined as undefined | Execution
  )
  console.info(lastExecution)
}
