import { ExecuteStepRetryError } from '../errors/errors.js'
import type { ExecutionAction, TaskExecutionActionType } from '../types/core.js'
import type { TaskContext, TaskExtraBase, TaskResult } from '../types/tasks.js'

export abstract class BaseStepExecutionTask<
  TContext extends TaskExtraBase,
  TPayload = unknown,
> {
  abstract readonly type: string
  abstract readonly actionType: TaskExecutionActionType

  async shouldRun(
    _context: TaskContext<TContext>,
    _action?: ExecutionAction,
    _payload?: TPayload
  ): Promise<boolean> {
    return Promise.resolve(true)
  }

  protected abstract run(
    context: TaskContext<TContext>,
    action: ExecutionAction,
    payload?: TPayload
  ): Promise<TaskResult>

  async execute(
    context: TaskContext<TContext>,
    payload?: TPayload
  ): Promise<TaskResult> {
    let action: ExecutionAction | undefined
    const { getAction, createAction, statusManager, step, parseErrors } =
      context
    try {
      action = getAction(this.actionType)
      const shouldRun = await this.shouldRun(context, action, payload)
      if (!shouldRun) {
        return { status: 'COMPLETED' }
      }
      if (!action) {
        action = createAction(this.actionType)
      }
      return await this.run(context, action, payload)
    } catch (error: any) {
      const actionOnError = error.action ?? action
      const parsed = await parseErrors(error, step, actionOnError)
      if (!(parsed instanceof ExecuteStepRetryError) && actionOnError) {
        statusManager.updateAction(step, actionOnError.type, 'FAILED', {
          error: {
            message: parsed.cause?.message,
            code: parsed.code,
          },
        })
      }
      throw parsed
    }
  }
}
