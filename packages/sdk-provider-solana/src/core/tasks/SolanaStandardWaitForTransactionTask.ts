import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  RPCError,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { getBase64EncodedWireTransaction } from '@solana/kit'
import { sendAndConfirmTransaction } from '../../actions/sendAndConfirmTransaction.js'
import { callSolanaRpcsWithRetry } from '../../rpc/utils.js'
import type { SolanaStepExecutorContext } from '../../types.js'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'

export class SolanaStandardWaitForTransactionTask extends BaseStepExecutionTask {
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

    if (!context.skipSimulation) {
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
        const cause = new SolanaTransactionDetailsError(
          simulationResult.value.err,
          simulationResult.value.logs
        )
        throw new TransactionError(
          LiFiErrorCode.TransactionSimulationFailed,
          `Transaction simulation failed: ${cause.message}`,
          cause
        )
      }
    }

    const { result, txSignature } = await sendAndConfirmTransaction(
      client,
      signedTransaction
    )

    if (result.kind === 'rpc-unavailable') {
      throw new RPCError(
        LiFiErrorCode.RpcUnavailable,
        'Unable to confirm transaction: no Solana RPC returned a usable response.',
        result.errors.length
          ? new AggregateError(result.errors, 'All Solana RPCs failed')
          : undefined
      )
    }

    if (result.kind === 'not-confirmed') {
      throw new TransactionError(
        LiFiErrorCode.TransactionExpired,
        'Transaction was not confirmed before the SDK stopped waiting.'
      )
    }

    if (result.value.err) {
      const cause = new SolanaTransactionDetailsError(result.value.err)
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${cause.message}`,
        cause
      )
    }

    const confirmedTransaction = {
      txSignature,
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
