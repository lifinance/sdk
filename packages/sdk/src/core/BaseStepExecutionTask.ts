import type { ExecutionAction } from '../types/core.js'
import type { TaskContext, TaskExtraBase, TaskResult } from '../types/tasks.js'

export abstract class BaseStepExecutionTask<
  TContext extends TaskExtraBase,
  TPayload = unknown,
> {
  async shouldRun(
    _context: TaskContext<TContext>,
    action: ExecutionAction,
    _payload?: TPayload
  ): Promise<boolean> {
    return action.status !== 'DONE'
  }

  abstract run(
    context: TaskContext<TContext>,
    action: ExecutionAction,
    payload?: TPayload
  ): Promise<TaskResult>
}
