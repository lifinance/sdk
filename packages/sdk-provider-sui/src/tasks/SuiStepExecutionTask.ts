import { BaseStepExecutionTask, type TaskContext } from '@lifi/sdk'
import { parseSuiErrors } from '../errors/parseSuiErrors.js'
import type { SuiTaskExtra } from './types.js'

/**
 * Base class for Sui pipeline tasks. Implements handleError via parseSuiErrors + updateAction(FAILED).
 * Subclasses implement run() and optionally override shouldRun().
 */
export abstract class SuiStepExecutionTask<
  TResult = void,
> extends BaseStepExecutionTask<SuiTaskExtra, TResult> {
  protected override async handleError(
    error: Error,
    context: TaskContext<SuiTaskExtra>
  ): Promise<never> {
    const parsed = await parseSuiErrors(error, context.step, context.action)
    context.action = context.statusManager.updateAction(
      context.step,
      context.actionType,
      'FAILED',
      {
        error: {
          message: parsed.cause?.message ?? parsed.message,
          code: parsed.code ?? 'UNKNOWN',
        },
      }
    )
    throw parsed
  }
}
