import type {
  PipelineResult,
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
   * Resume pipeline from saved state (re-executes the paused task, then continues).
   * Context is rebuilt from baseContext; step state is already on step.execution.
   */
  async resume(
    pausedAtTask: string,
    baseContext: StepExecutorContext<TContext>
  ): Promise<PipelineResult> {
    const pausedIndex = this.tasks.findIndex((t) => t.type === pausedAtTask)
    const tasksToRun =
      pausedIndex < 0 ? this.tasks : this.tasks.slice(pausedIndex)
    return this.runTaskLoop(tasksToRun, baseContext as TaskContext<TContext>)
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
        return { status: 'PAUSED', pausedAtTask: task.type }
      }
    }
    return { status: 'COMPLETED' }
  }
}
