import type { ExecutionAction } from '../types/core.js'
import type { TaskContext, TaskExtraBase, TaskResult } from '../types/tasks.js'

export abstract class BaseStepExecutionTask<
  TContext extends TaskExtraBase,
  TPayload = unknown,
> {
  async shouldRun(
    _context: TaskContext<TContext>,
    _action?: ExecutionAction,
    _payload?: TPayload
  ): Promise<boolean> {
    return Promise.resolve(true)
  }

  abstract run(
    context: TaskContext<TContext>,
    action: ExecutionAction,
    payload?: TPayload
  ): Promise<TaskResult>
}
