import {
  BaseStepExecutionTask,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { Transaction } from '@mysten/sui/transactions'
import type { SuiStepExecutorContext } from '../../types.js'

export class SuiSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: SuiStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      suiClient,
      signer,
      statusManager,
      executionOptions,
      isBridgeExecution,
      checkWallet,
    } = context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    const transactionRequestData = await getTransactionRequestData(
      step,
      executionOptions
    )

    checkWallet(step)

    // We give users 2 minutes to sign the transaction
    const {
      $kind,
      FailedTransaction,
      Transaction: TransactionResult,
    } = await suiClient.core.signAndExecuteTransaction({
      signer,
      transaction: Transaction.from(transactionRequestData),
    })

    statusManager.updateAction(step, action.type, 'PENDING', {
      signedAt: Date.now(),
    })

    if ($kind !== 'Transaction' || !TransactionResult) {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${FailedTransaction?.status.error ?? `Unexpected transaction result: ${$kind}`}`
      )
    }

    return {
      status: 'COMPLETED',
      context: { signedTransaction: TransactionResult },
    }
  }
}
