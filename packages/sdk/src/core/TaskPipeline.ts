import { ExecuteStepRetryError } from '../errors/errors.js'
import type { StepExecutorContext, TaskResult } from '../types/execution.js'
import type { BaseStepExecutionTask } from './BaseStepExecutionTask.js'

export class TaskPipeline {
  private readonly tasks: BaseStepExecutionTask[]

  constructor(tasks: BaseStepExecutionTask[]) {
    this.tasks = tasks
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { statusManager, step, parseErrors, firstTaskName } = context

    let tasksToRun = this.tasks
    if (firstTaskName) {
      const firstTaskIndex = tasksToRun.findIndex(
        (task) => task.taskName === firstTaskName
      )
      if (firstTaskIndex >= 0) {
        tasksToRun = tasksToRun.slice(firstTaskIndex)
      }
    }

    for (const task of tasksToRun) {
      const shouldRun = await task.shouldRun(context)
      if (!shouldRun) {
        continue
      }
      try {
        const result = await task.run(context)
        if (result.status === 'PAUSED') {
          return { status: 'PAUSED' }
        }
      } catch (error: any) {
        const action = step?.execution?.actions?.at(-1)
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
