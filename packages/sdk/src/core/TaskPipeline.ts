import type {
  PipelineResult,
  PipelineSavedState,
  StepExecutorContext,
  TaskContext,
  TaskExtraBase,
} from '../types/tasks.js'
import type { BaseStepExecutionTask } from './BaseStepExecutionTask.js'

export class TaskPipeline<TContext extends TaskExtraBase = TaskExtraBase> {
  constructor(private tasks: BaseStepExecutionTask<TContext>[]) {}

  /**
   * Run all tasks in sequence
   */
  async run(
    baseContext: StepExecutorContext<TContext>
  ): Promise<PipelineResult> {
    return this.runTaskLoop(this.tasks, baseContext)
  }

  /**
   * Resume pipeline from saved state (re-executes the paused task, then continues)
   */
  async resume(
    savedState: PipelineSavedState,
    baseContext: StepExecutorContext<TContext>
  ): Promise<PipelineResult> {
    const pipelineContext = savedState.pipelineContext
    const pausedIndex = this.tasks.findIndex(
      (t) => t.type === savedState.pausedAtTask
    )
    const tasksToRun =
      pausedIndex < 0 ? this.tasks : this.tasks.slice(pausedIndex)
    const context = {
      ...baseContext,
      ...pipelineContext,
    } as TaskContext<TContext>
    return this.runTaskLoop(tasksToRun, context)
  }

  /**
   * Run the given tasks in sequence with the given pipeline context
   */
  private async runTaskLoop(
    tasksToRun: BaseStepExecutionTask<TContext>[],
    context: TaskContext<TContext>
  ): Promise<PipelineResult> {
    for (const task of tasksToRun) {
      const result = await task.execute(context)
      if (result.status === 'PAUSED') {
        return {
          status: 'PAUSED',
          pausedAtTask: task.type,
          pipelineContext: context,
        }
      }
    }
    return { status: 'COMPLETED', pipelineContext: context }
  }
}
