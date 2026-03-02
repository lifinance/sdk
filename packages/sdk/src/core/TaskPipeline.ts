import type { StepExecutorContext, TaskResult } from '../types/execution.js'
import type { BaseStepExecutionTask } from './BaseStepExecutionTask.js'

export class TaskPipeline {
  private readonly tasks: BaseStepExecutionTask[]

  constructor(tasks: BaseStepExecutionTask[]) {
    this.tasks = tasks
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    for (const task of this.tasks) {
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
    }

    return { status: 'COMPLETED' }
  }
}
