import type {
  ExecutionTask,
  PipelineContext,
  PipelineSavedState,
  TaskContext,
} from '../types/tasks.js'

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

export class TaskPipeline {
  constructor(private tasks: ExecutionTask[]) {}

  /**
   * Run all tasks in sequence
   */
  async run(
    baseContext: Omit<TaskContext, 'pipelineContext'>
  ): Promise<PipelineResult> {
    return this.runTaskLoop(this.tasks, {}, baseContext)
  }

  /**
   * Resume pipeline from saved state (re-executes the paused task, then continues)
   */
  async resume(
    savedState: PipelineSavedState,
    baseContext: Omit<TaskContext, 'pipelineContext'>
  ): Promise<PipelineResult> {
    const pipelineContext = savedState.pipelineContext
    const pausedIndex = this.tasks.findIndex(
      (t) => t.type === savedState.pausedAtTask
    )
    if (pausedIndex < 0) {
      return this.runTaskLoop(this.tasks, pipelineContext, baseContext)
    }

    const pausedTask = this.tasks[pausedIndex]
    const context: TaskContext = {
      ...(baseContext as TaskContext),
      pipelineContext,
    }
    const result = await pausedTask.execute(context)

    if (result.status === 'PAUSED') {
      return {
        status: 'PAUSED',
        pausedAtTask: pausedTask.type,
        pipelineContext,
      }
    }

    const remainingTasks = this.tasks.slice(pausedIndex + 1)
    return this.runTaskLoop(remainingTasks, pipelineContext, baseContext)
  }

  /**
   * Run the given tasks in sequence with the given pipeline context
   */
  private async runTaskLoop(
    tasksToRun: ExecutionTask[],
    pipelineContext: PipelineContext,
    baseContext: Omit<TaskContext, 'pipelineContext'>
  ): Promise<PipelineResult> {
    for (const task of tasksToRun) {
      const context: TaskContext = {
        ...(baseContext as TaskContext),
        pipelineContext,
      }

      const shouldRun = await task.shouldRun(context)
      if (!shouldRun) {
        continue
      }

      const result = await task.execute(context)

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
