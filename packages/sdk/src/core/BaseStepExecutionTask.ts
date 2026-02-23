import type { StepExecutorContext, TaskResult } from '../types/execution.js'

export abstract class BaseStepExecutionTask {
  static readonly name: string
  abstract readonly taskName: string

  shouldRun(_context: StepExecutorContext): Promise<boolean> {
    return Promise.resolve(true)
  }

  abstract run(context: StepExecutorContext): Promise<TaskResult>
}
