import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { callSuiWithRetry } from '../../client/suiClient.js'
import type { SuiStepExecutorContext } from '../../types.js'

export class SuiWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SuiStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      signedTransaction,
    } = context

    if (!signedTransaction) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Signed transaction is not found.'
      )
    }

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

    const result = await callSuiWithRetry(client, (client) =>
      client.core.waitForTransaction({
        digest: signedTransaction.digest,
      })
    )

    const transaction = result.Transaction ?? result.FailedTransaction
    if (!transaction?.status.success) {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${transaction?.status.error?.message ?? `Unexpected transaction result: ${result.$kind}`}`
      )
    }

    // Transaction has been confirmed and we can update the action
    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: transaction.digest,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}txblock/${transaction.digest}`,
    })

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
