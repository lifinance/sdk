import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import {
  getBase64EncodedWireTransaction,
  getTransactionCodec,
} from '@solana/kit'
import { sendAndConfirmTransaction } from '../actions/sendAndConfirmTransaction.js'
import { callSolanaWithRetry } from '../client/connection.js'
import { base64ToUint8Array } from '../utils/base64ToUint8Array.js'
import type { SolanaTaskExtra } from './types.js'

export class SolanaWaitForTransactionTask
  implements ExecutionTask<SolanaTaskExtra, void>
{
  readonly type = 'SOLANA_WAIT_FOR_TRANSACTION'
  readonly displayName = 'Confirm transaction'

  async shouldRun(context: TaskContext<SolanaTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  async execute(
    context: TaskContext<SolanaTaskExtra>
  ): Promise<TaskResult<void>> {
    const {
      client,
      step,
      statusManager,
      actionType,
      fromChain,
      isBridgeExecution,
    } = context

    const signedTransactionBase64 = (
      context as unknown as Record<string, unknown>
    ).signedTransactionBase64 as string | undefined

    if (!signedTransactionBase64) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Signed transaction is missing.'
      )
    }

    const transactionCodec = getTransactionCodec()
    const signedTransaction = transactionCodec.decode(
      base64ToUint8Array(signedTransactionBase64)
    )
    const encodedTransaction =
      getBase64EncodedWireTransaction(signedTransaction)

    const simulationResult = await callSolanaWithRetry(client, (connection) =>
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

    const confirmedTransaction = await sendAndConfirmTransaction(
      client,
      signedTransaction
    )

    if (!confirmedTransaction.signatureResult) {
      throw new TransactionError(
        LiFiErrorCode.TransactionExpired,
        'Transaction has expired: The block height has exceeded the maximum allowed limit.'
      )
    }

    if (confirmedTransaction.signatureResult.err) {
      const reason =
        typeof confirmedTransaction.signatureResult.err === 'object'
          ? JSON.stringify(confirmedTransaction.signatureResult.err)
          : confirmedTransaction.signatureResult.err
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${reason}`
      )
    }

    context.action = statusManager.updateAction(step, actionType, 'PENDING', {
      txHash: confirmedTransaction.txSignature,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${confirmedTransaction.txSignature}`,
    })

    if (isBridgeExecution) {
      context.action = statusManager.updateAction(step, actionType, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
