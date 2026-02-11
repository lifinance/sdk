import { ExecuteStepRetryError } from '../errors/errors.js'
import type { ExecutionAction, ExecutionActionType } from '../types/core.js'
import type { StepExecutorContext, TaskResult } from '../types/tasks.js'
import type { BaseStepExecutionTask } from './BaseStepExecutionTask.js'

export type TaskPipelineRunWhen = (
  context: StepExecutorContext,
  payload?: unknown
) => boolean | Promise<boolean>

/**
 * Action-centric pipeline: accepts actionType and a list of tasks.
 * When an action is not done, the whole pipeline runs from the start.
 * Tasks individually check shouldRun.
 * Optional runWhen: when provided, the pipeline runs only when it returns true.
 */
export class TaskPipeline {
  readonly actionType: ExecutionActionType
  private readonly tasks: BaseStepExecutionTask[]
  private readonly runWhen?: TaskPipelineRunWhen

  constructor(
    actionType: ExecutionActionType,
    tasks: BaseStepExecutionTask[],
    runWhen?: TaskPipelineRunWhen
  ) {
    this.actionType = actionType
    this.tasks = tasks
    this.runWhen = runWhen
  }

  async shouldRun(
    context: StepExecutorContext,
    action?: ExecutionAction,
    payload?: unknown
  ): Promise<boolean> {
    if (!this.runWhen) {
      return action?.status !== 'DONE'
    }
    return this.runWhen(context, payload)
  }

  async run(
    context: StepExecutorContext,
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
