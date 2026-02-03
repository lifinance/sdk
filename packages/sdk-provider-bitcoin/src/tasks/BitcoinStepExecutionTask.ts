import { BaseStepExecutionTask, type TaskContext } from '@lifi/sdk'
import { parseBitcoinErrors } from '../errors/parseBitcoinErrors.js'
import type { BitcoinTaskExtra } from './types.js'

/**
 * Base class for Bitcoin pipeline tasks. Implements handleError via parseBitcoinErrors + updateAction(FAILED).
 * Subclasses implement run() and optionally override shouldRun().
 */
export abstract class BitcoinStepExecutionTask<
  TResult = void,
> extends BaseStepExecutionTask<BitcoinTaskExtra, TResult> {
  protected override async handleError(
    error: Error,
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<never> {
    const parsed = await parseBitcoinErrors(error, context.step, context.action)
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
