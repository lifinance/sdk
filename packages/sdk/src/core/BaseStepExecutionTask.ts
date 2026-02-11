import type { ExecutionAction } from '../types/core.js'
import type { StepExecutorContext, TaskResult } from '../types/tasks.js'

export abstract class BaseStepExecutionTask<TPayload = unknown> {
  async shouldRun(
    _context: StepExecutorContext,
    action: ExecutionAction,
    _payload?: TPayload
  ): Promise<boolean> {
    return action.status !== 'DONE'
  }

  abstract run(
    context: StepExecutorContext,
    action: ExecutionAction,
    payload?: TPayload
  ): Promise<TaskResult>
}
