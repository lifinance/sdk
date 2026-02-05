import type {
  PipelineContext,
  PipelineSavedState,
  TaskContext,
  TaskExtraBase,
} from '../types/tasks.js'
import type { BaseStepExecutionTask } from './BaseStepExecutionTask.js'

type PipelineResult =
  | {
      status: 'COMPLETED'
      pipelineContext: PipelineContext
    }
  | {
      status: 'PAUSED'
      pausedAtTask: string
      pipelineContext: PipelineContext
    }

export class TaskPipeline<
  TContext extends TaskExtraBase = TaskExtraBase,
  TResult = unknown,
> {
  constructor(private tasks: BaseStepExecutionTask<TContext, TResult>[]) {}

  /**
   * Run all tasks in sequence
   */
  async run(
    baseContext: Omit<TaskContext<TContext>, 'pipelineContext'>
  ): Promise<PipelineResult> {
    return this.runTaskLoop(this.tasks, {}, baseContext)
  }

  /**
   * Resume pipeline from saved state (re-executes the paused task, then continues)
   */
  async resume(
    savedState: PipelineSavedState,
    baseContext: Omit<TaskContext<TContext>, 'pipelineContext'>
  ): Promise<PipelineResult> {
    const pipelineContext = savedState.pipelineContext
    const pausedIndex = this.tasks.findIndex(
      (t) => t.type === savedState.pausedAtTask
    )
    const tasksToRun =
      pausedIndex < 0 ? this.tasks : this.tasks.slice(pausedIndex)
    return this.runTaskLoop(tasksToRun, pipelineContext, baseContext)
  }

  /**
   * Run the given tasks in sequence with the given pipeline context
   */
  private async runTaskLoop(
    tasksToRun: BaseStepExecutionTask<TContext, TResult>[],
    pipelineContext: PipelineContext,
    baseContext: Omit<TaskContext<TContext>, 'pipelineContext'>
  ): Promise<PipelineResult> {
    for (const task of tasksToRun) {
      const context = {
        ...(baseContext as TaskContext<TContext>),
        ...pipelineContext,
        pipelineContext,
      }
      const result = await task.execute(context)
      if (result.data && typeof result.data === 'object') {
        Object.assign(pipelineContext, result.data)
      }
      if (result.status === 'PAUSED') {
        return {
          status: 'PAUSED',
          pausedAtTask: task.type,
          pipelineContext,
        }
      }
    }
    return { status: 'COMPLETED', pipelineContext }
  }
}
