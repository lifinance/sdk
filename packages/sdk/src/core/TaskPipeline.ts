import { ExecuteStepRetryError } from '../errors/errors.js'
import type { ExecutionAction, ExecutionActionType } from '../types/core.js'
import type { StepExecutorContext, TaskResult } from '../types/execution.js'
import type { BaseStepExecutionTask } from './BaseStepExecutionTask.js'

export class TaskPipeline {
  readonly actionType: ExecutionActionType
  private readonly tasks: BaseStepExecutionTask[]

  constructor(actionType: ExecutionActionType, tasks: BaseStepExecutionTask[]) {
    this.actionType = actionType
    this.tasks = tasks
  }

  async shouldRun(
    _context: StepExecutorContext,
    action?: ExecutionAction
  ): Promise<boolean> {
    return action?.status !== 'DONE'
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { statusManager, step, parseErrors } = context
    for (const task of this.tasks) {
      const action = statusManager.findOrCreateAction({
        step,
        type: this.actionType,
        chainId:
          this.actionType === 'RECEIVING_CHAIN'
            ? step.action.toChainId
            : step.action.fromChainId,
      })
      try {
        const shouldRun = await task.shouldRun(context, action)
        if (!shouldRun) {
          continue
        }
        const result = await task.run(context, action)
        if (result.status === 'ACTION_REQUIRED') {
          return { status: 'ACTION_REQUIRED' }
        }
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
    return { status: 'COMPLETED' }
  }
}
