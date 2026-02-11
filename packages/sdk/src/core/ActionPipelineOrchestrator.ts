import type { StepExecutorContext, TaskResult } from '../types/tasks.js'
import type { TaskPipeline } from './TaskPipeline.js'

/**
 * Orchestrates action pipelines in order.
 * Iterates through pipelines; for each, checks if action is done.
 * If not done, runs that pipeline from the start.
 */
export class ActionPipelineOrchestrator {
  constructor(private pipelines: TaskPipeline[]) {}

  async run(
    context: StepExecutorContext,
    payload?: unknown
  ): Promise<TaskResult> {
    const { statusManager, step } = context
    for (const pipeline of this.pipelines) {
      const action = statusManager.findAction(step, pipeline.actionType)
      const shouldRun = await pipeline.shouldRun(context, action, payload)
      if (!shouldRun) {
        continue
      }
      const result = await pipeline.run(context, payload)
      if (result.status === 'PAUSED') {
        return result
      }
      payload = result.data // TODO: reduce where possible and type it
    }
    return { status: 'COMPLETED', data: payload }
  }
}
