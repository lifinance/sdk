import type { ExecutionAction } from '../types/core.js'
import type { StepExecutorContext, TaskResult } from '../types/execution.js'

export abstract class BaseStepExecutionTask {
  async shouldRun(
    _context: StepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return action.status !== 'DONE'
  }

  abstract run(
    context: StepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult>
}
