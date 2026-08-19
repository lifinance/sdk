import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  RPCError,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
} from '@solana/kit'
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

    // Derived with the same pure function `SolanaSignAndExecuteTask` used for
    // the early `txHash` write, so the two writers cannot disagree.
    const txSignature = getSignatureFromTransaction(signedTransaction)
    const txLink = `${fromChain.metamask.blockExplorerUrls[0]}tx/${txSignature}`

    const { result } = await sendAndConfirmTransaction(
      client,
      signedTransaction,
      {
        // The explorer link is written the moment the first RPC accepts the
        // send - not at signing time, when it would point at a transaction
        // that may never be broadcast, and not as late as confirmation, which
        // would hide the link exactly while a user wants to watch the
        // transaction land.
        onBroadcast: () => {
          statusManager.updateAction(step, action.type, 'PENDING', {
            txLink,
          })
        },
      }
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
      // The verdict came from a branch that polled to its deadline and saw
      // nothing, but other branches may have died trying - and their errors
      // are the only trail explaining, say, an endpoint that never answered.
      throw new TransactionError(
        LiFiErrorCode.TransactionExpired,
        'Transaction was not confirmed before the SDK stopped waiting.',
        result.errors.length
          ? new AggregateError(
              result.errors,
              'Some Solana RPCs failed while the confirmation window was open'
            )
          : undefined
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

    // Transaction has been confirmed and we can update the action
    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: txSignature,
      txLink,
    })

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
