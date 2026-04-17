import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { sendAndConfirmBundle } from '../../actions/sendAndConfirmBundle.js'
import type { SolanaStepExecutorContext } from '../../types.js'

export class SolanaJitoWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      signedTransactions: contextSignedTransactions,
    } = context

    const signedTransactions = contextSignedTransactions ?? []

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

    // Use Jito bundle for transaction submission
    const bundleResult = await sendAndConfirmBundle(client, signedTransactions)

    const allConfirmed = bundleResult.signatureResults.every(
      (result) => result !== null
    )

    if (!allConfirmed) {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'Bundle confirmation failed: Not all transactions were confirmed.'
      )
    }

    // Check for errors in any of the transactions
    const failedResult = bundleResult.signatureResults.find(
      (result) => result?.err
    )
    if (failedResult?.err) {
      const reason =
        typeof failedResult.err === 'object'
          ? JSON.stringify(failedResult.err)
          : String(failedResult.err)
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${reason}`
      )
    }

    const confirmedTransaction = {
      txSignature: bundleResult.txSignatures[0],
      bundleId: bundleResult.bundleId,
    }

    // Transaction has been confirmed and we can update the action
    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: confirmedTransaction.txSignature,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${confirmedTransaction.txSignature}`,
    })

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
