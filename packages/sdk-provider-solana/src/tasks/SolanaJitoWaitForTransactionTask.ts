import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Transaction } from '@solana/kit'
import { sendAndConfirmBundle } from '../actions/sendAndConfirmBundle.js'
import type { SolanaStepExecutorContext } from '../types.js'

export class SolanaJitoWaitForTransactionTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: SolanaStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: SolanaStepExecutorContext,
    action: ExecutionAction,
    payload: { signedTransactions: Transaction[] }
  ): Promise<TaskResult> {
    const { client, step, statusManager, fromChain, isBridgeExecution } =
      context
    const { signedTransactions } = payload

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
