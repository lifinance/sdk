import { ExecuteStepRetryError } from '../errors/errors.js'
import type {
  StepExecutionError,
  TaskContext,
  TaskExtraBase,
  TaskResult,
} from '../types/tasks.js'

/**
 * Base class for step pipeline tasks across all ecosystems. execute() wraps run() in try-catch,
 * parses errors via context.parseErrors, updates action to FAILED, then rethrows.
 * TContext must extend TaskExtraBase so context has parseErrors and getAction.
 */
export abstract class BaseStepExecutionTask<
  TContext extends TaskExtraBase,
  TResult = unknown,
> {
  abstract readonly type: string

  /** Override to add conditions; default returns true (task always runs). */
  async shouldRun(_context: TaskContext<TContext>): Promise<boolean> {
    return Promise.resolve(true)
  }

  /**
   * Subclasses implement this instead of execute(). The base class wraps it in try-catch, parses errors, updates action to FAILED, then rethrows.
   */
  protected abstract run(
    context: TaskContext<TContext>
  ): Promise<TaskResult<TResult>>

  async execute(context: TaskContext<TContext>): Promise<TaskResult<TResult>> {
    try {
      const shouldRun = await this.shouldRun(context)
      if (!shouldRun) {
        return { status: 'COMPLETED' }
      }
      return await this.run(context)
    } catch (err) {
      const error = err as StepExecutionError
      const parsed = await context.parseErrors(
        error,
        context.step,
        error.action
      )
      if (!(parsed instanceof ExecuteStepRetryError) && error.action) {
        context.statusManager.updateAction(
          context.step,
          error.action.type,
          'FAILED',
          {
            error: {
              message: parsed.cause?.message,
              code: parsed.code,
            },
          }
        )
      }
      throw parsed
    }
  }
}
