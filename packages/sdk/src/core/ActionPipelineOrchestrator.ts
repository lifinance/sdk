import type {
  StepExecutorContext,
  TaskExtraBase,
  TaskResult,
} from '../types/tasks.js'
import type { TaskPipeline } from './TaskPipeline.js'

/**
 * Orchestrates action pipelines in order.
 * Iterates through pipelines; for each, checks if action is done.
 * If not done, runs that pipeline from the start.
 */
export class ActionPipelineOrchestrator<
  TContext extends TaskExtraBase = TaskExtraBase,
> {
  constructor(private pipelines: TaskPipeline<TContext>[]) {}

  async run(
    context: StepExecutorContext<TContext>,
    payload?: unknown
  ): Promise<TaskResult> {
    const { statusManager, step } = context
    for (const pipeline of this.pipelines) {
      const action = statusManager.findAction(step, pipeline.actionType)
      if (action?.status === 'DONE') {
        continue
      }
      const result = await pipeline.run(context, payload)
      if (result.status === 'PAUSED') {
        return result
      }
      payload = result.data
    }
    return { status: 'COMPLETED', data: payload }
  }
}
