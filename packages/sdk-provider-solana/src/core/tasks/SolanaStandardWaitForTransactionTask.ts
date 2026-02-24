import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { getBase64EncodedWireTransaction } from '@solana/kit'
import { sendAndConfirmTransaction } from '../../actions/sendAndConfirmTransaction.js'
import { callSolanaRpcsWithRetry } from '../../rpc/utils.js'
import type { SolanaStepExecutorContext } from '../../types.js'

export class SolanaStandardWaitForTransactionTask extends BaseStepExecutionTask {
  static override readonly name =
    'SOLANA_STANDARD_WAIT_FOR_TRANSACTION' as const
  override readonly taskName = SolanaStandardWaitForTransactionTask.name

  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      tasksResults,
    } = context

    const signedTransactions = tasksResults.signedTransactions ?? []

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

    if (!signedTransactions.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Signed transactions are not found.'
      )
    }

    // Use regular transaction submission
    const signedTransaction = signedTransactions[0]

    const encodedTransaction =
      getBase64EncodedWireTransaction(signedTransaction)

    const simulationResult = await callSolanaRpcsWithRetry(
      client,
      (connection) =>
        connection
          .simulateTransaction(encodedTransaction, {
            commitment: 'confirmed',
            replaceRecentBlockhash: true,
            encoding: 'base64',
          })
          .send()
    )

    if (simulationResult.value.err) {
      const errorMessage =
        typeof simulationResult.value.err === 'object'
          ? JSON.stringify(simulationResult.value.err)
          : simulationResult.value.err
      throw new TransactionError(
        LiFiErrorCode.TransactionSimulationFailed,
        `Transaction simulation failed: ${errorMessage}`,
        new Error(errorMessage)
      )
    }

    const result = await sendAndConfirmTransaction(client, signedTransaction)

    if (!result.signatureResult) {
      throw new TransactionError(
        LiFiErrorCode.TransactionExpired,
        'Transaction has expired: The block height has exceeded the maximum allowed limit.'
      )
    }

    if (result.signatureResult.err) {
      const reason =
        typeof result.signatureResult.err === 'object'
          ? JSON.stringify(result.signatureResult.err)
          : result.signatureResult.err
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${reason}`
      )
    }

    const confirmedTransaction = {
      txSignature: result.txSignature,
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
