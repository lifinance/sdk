import { BaseStepExecutionTask, type TaskContext } from '@lifi/sdk'
import { parseSolanaErrors } from '../errors/parseSolanaErrors.js'
import type { SolanaTaskExtra } from './types.js'

/**
 * Base class for Solana pipeline tasks. Implements handleError via parseSolanaErrors + updateAction(FAILED).
 * Subclasses implement run() and optionally override shouldRun().
 */
export abstract class SolanaStepExecutionTask<
  TResult = void,
> extends BaseStepExecutionTask<SolanaTaskExtra, TResult> {
  protected override async handleError(
    error: Error,
    context: TaskContext<SolanaTaskExtra>
  ): Promise<never> {
    const parsed = await parseSolanaErrors(error, context.step, context.action)
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
