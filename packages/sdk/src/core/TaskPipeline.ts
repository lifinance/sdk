import { ExecuteStepRetryError } from '../errors/errors.js'
import type { ExecutionActionType } from '../types/core.js'
import type {
  StepExecutorContext,
  TaskExtraBase,
  TaskResult,
} from '../types/tasks.js'
import type { BaseStepExecutionTask } from './BaseStepExecutionTask.js'

/**
 * Action-centric pipeline: accepts actionType and a list of tasks.
 * When an action is not done, the whole pipeline runs from the start.
 * Tasks individually check shouldRun.
 */
export class TaskPipeline<TContext extends TaskExtraBase = TaskExtraBase> {
  readonly actionType: ExecutionActionType
  private tasks: BaseStepExecutionTask<TContext>[]

  constructor(
    actionType: ExecutionActionType,
    tasks: BaseStepExecutionTask<TContext>[]
  ) {
    this.actionType = actionType
    this.tasks = tasks
  }

  async run(
    context: StepExecutorContext<TContext>,
    payload?: unknown
  ): Promise<TaskResult> {
    const { statusManager, step, parseErrors } = context
    for (const task of this.tasks) {
      const action = statusManager.findOrCreateAction({
        step,
        type: this.actionType,
        chainId: step.action.fromChainId,
      })
      try {
        const shouldRun = await task.shouldRun(context, action, payload)
        if (!shouldRun) {
          continue
        }
        const result = await task.run(context, action, payload)
        if (result.status === 'PAUSED') {
          return { status: 'PAUSED' }
        }
        payload = result.data
      } catch (error: any) {
        const parsed = await parseErrors(error, step, action)
        if (!(parsed instanceof ExecuteStepRetryError) && action) {
          statusManager.updateAction(step, this.actionType, 'FAILED', {
            error: {
              message: parsed.cause?.message,
              code: parsed.code,
            },
          })
        }
        throw parsed
      }
    }
    return { status: 'COMPLETED', data: payload }
  }
}
