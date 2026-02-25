import { ExecuteStepRetryError } from '../errors/errors.js'
import type { StepExecutorContext, TaskResult } from '../types/execution.js'
import type { BaseStepExecutionTask } from './BaseStepExecutionTask.js'

export class TaskPipeline {
  private readonly tasks: BaseStepExecutionTask[]

  constructor(tasks: BaseStepExecutionTask[]) {
    this.tasks = tasks
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { statusManager, step, parseErrors } = context

    for (const task of this.tasks) {
      try {
        const shouldRun = await task.shouldRun(context)
        if (!shouldRun) {
          continue
        }
        const result = await task.run(context)
        if (result.status === 'PAUSED') {
          return { status: 'PAUSED' }
        }
        if (result.context && typeof result.context === 'object') {
          Object.assign(context, result.context)
        }
      } catch (error: any) {
        const action = step?.execution?.lastActionType
          ? statusManager.findAction(step, step?.execution?.lastActionType)
          : undefined
        const parsed = await parseErrors(error, step, action)
        if (!(parsed instanceof ExecuteStepRetryError) && action) {
          statusManager.updateAction(step, action.type, 'FAILED', {
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
