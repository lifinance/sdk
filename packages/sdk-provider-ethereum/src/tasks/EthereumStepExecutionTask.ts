import {
  BaseStepExecutionTask,
  ExecuteStepRetryError,
  type TaskContext,
} from '@lifi/sdk'
import {
  isAtomicReadyWalletRejectedUpgradeError,
  parseEthereumErrors,
} from '../errors/parseEthereumErrors.js'
import type { EthereumTaskExtra } from './types.js'

/**
 * Base class for Ethereum pipeline tasks. Implements handleError via parseEthereumErrors + updateAction(FAILED).
 * Subclasses implement run() and optionally override shouldRun().
 */
export abstract class EthereumStepExecutionTask<
  TResult = void,
> extends BaseStepExecutionTask<EthereumTaskExtra, TResult> {
  protected override async handleError(
    error: Error,
    context: TaskContext<EthereumTaskExtra>
  ): Promise<never> {
    if (
      isAtomicReadyWalletRejectedUpgradeError(error) &&
      !context.retryParams?.atomicityNotReady
    ) {
      throw new ExecuteStepRetryError(
        'Wallet rejected 7702 upgrade based on the EIP-5792 capabilities; retry with atomicityNotReady',
        { atomicityNotReady: true },
        error
      )
    }
    const parsed = await parseEthereumErrors(
      error,
      context.step,
      context.action
    )
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
