import type { StepExecutorContext, TaskResult } from '../types/execution.js'
import type { TaskPipeline } from './TaskPipeline.js'

export class ActionPipelineOrchestrator {
  constructor(private pipelines: TaskPipeline[]) {}

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { statusManager, step } = context
    for (const pipeline of this.pipelines) {
      const action = statusManager.findAction(step, pipeline.actionType)
      const shouldRun = await pipeline.shouldRun(context, action)
      if (!shouldRun) {
        continue
      }
      const result = await pipeline.run(context)
      if (result.status === 'PAUSED') {
        return result
      }
    }
    return { status: 'COMPLETED' }
  }
}
