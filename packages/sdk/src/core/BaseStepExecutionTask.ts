import type { TaskContext, TaskResult } from '../types/tasks.js'

/**
 * Base class for step pipeline tasks across all ecosystems. execute() wraps run() in try-catch
 * and calls abstract handleError(error, context) on failure, then rethrows.
 * Subclasses implement run() and handleError() (e.g. EthereumTask implements handleError via parseErrors + updateAction(FAILED)).
 */
export abstract class BaseStepExecutionTask<TContext, TResult = unknown> {
  abstract readonly type: string

  /** Override to add conditions; default returns true (task always runs). */
  async shouldRun(_context: TaskContext<TContext>): Promise<boolean> {
    return Promise.resolve(true)
  }

  /**
   * Subclasses implement this instead of execute(). The base class wraps it in try-catch and calls handleError on failure.
   */
  protected abstract run(
    context: TaskContext<TContext>
  ): Promise<TaskResult<TResult>>

  /**
   * Called when run() throws. Subclasses must implement (e.g. parseErrors + updateAction(FAILED)); may rethrow or throw parsed error.
   */
  protected abstract handleError(
    error: Error,
    context: TaskContext<TContext>
  ): Promise<void>

  async execute(context: TaskContext<TContext>): Promise<TaskResult<TResult>> {
    try {
      return await this.run(context)
    } catch (error: any) {
      await this.handleError(error, context)
      throw error
    }
  }
}
