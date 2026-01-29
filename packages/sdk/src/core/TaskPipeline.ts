import type {
  ExecutionTask,
  PipelineContext,
  PipelineSavedState,
  TaskContext,
  TaskPipelineObserver,
  TaskState,
} from '../types/tasks.js'

const noopObserver: TaskPipelineObserver = {
  onTaskStarted() {},
  onTaskCompleted() {},
  onTaskSkipped() {},
}

type PipelineResult =
  | {
      status: 'COMPLETED'
      pipelineContext: PipelineContext
    }
  | {
      status: 'PAUSED'
      pausedAtTask: string
      taskState?: TaskState
      pipelineContext: PipelineContext
    }

export class TaskPipeline {
  constructor(
    private tasks: ExecutionTask[],
    private observer: TaskPipelineObserver = noopObserver // TODO: decide if we need to add an observer
  ) {}

  /**
   * Run all tasks in sequence
   */
  async run(
    baseContext: Omit<TaskContext, 'pipelineContext' | 'observer'>
  ): Promise<PipelineResult> {
    return this.runTaskLoop(this.tasks, {}, baseContext)
  }

  /**
   * Resume pipeline from saved state (re-executes the paused task, then continues)
   */
  async resume(
    savedState: PipelineSavedState,
    baseContext: Omit<TaskContext, 'pipelineContext' | 'observer'>
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
      observer: this.observer,
    }
    this.observer.onTaskStarted(pausedTask.type, pausedTask.displayName)
    const result = await pausedTask.execute(context)
    if (result.status === 'PAUSED') {
      return {
        status: 'PAUSED',
        pausedAtTask: pausedTask.type,
        taskState: result.saveState,
        pipelineContext,
      }
    }
    if (result.data && typeof result.data === 'object') {
      Object.assign(pipelineContext, result.data as Record<string, unknown>)
    }
    this.observer.onTaskCompleted(pausedTask.type)

    const remainingTasks = this.tasks.slice(pausedIndex + 1)
    return this.runTaskLoop(remainingTasks, pipelineContext, baseContext)
  }

  /**
   * Run the given tasks in sequence with the given pipeline context
   */
  private async runTaskLoop(
    tasksToRun: ExecutionTask[],
    pipelineContext: PipelineContext,
    baseContext: Omit<TaskContext, 'pipelineContext' | 'observer'>
  ): Promise<PipelineResult> {
    for (const task of tasksToRun) {
      const context: TaskContext = {
        ...(baseContext as TaskContext),
        pipelineContext,
        observer: this.observer,
      }

      const shouldRun = await task.shouldRun(context)
      if (!shouldRun) {
        this.observer.onTaskSkipped(task.type)
        continue
      }

      this.observer.onTaskStarted(task.type, task.displayName)

      const result = await task.execute(context)

      if (result.status === 'PAUSED') {
        return {
          status: 'PAUSED',
          pausedAtTask: task.type,
          taskState: result.saveState,
          pipelineContext,
        }
      }

      if (result.data && typeof result.data === 'object') {
        Object.assign(pipelineContext, result.data as Record<string, unknown>)
      }

      this.observer.onTaskCompleted(task.type)
    }

    return { status: 'COMPLETED', pipelineContext }
  }
}
