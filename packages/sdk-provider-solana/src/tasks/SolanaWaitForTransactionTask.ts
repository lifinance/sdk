import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { getBase64EncodedWireTransaction } from '@solana/kit'
import { sendAndConfirmTransaction } from '../actions/sendAndConfirmTransaction.js'
import { callSolanaWithRetry } from '../client/connection.js'
import type { SolanaTaskExtra } from './types.js'

export class SolanaWaitForTransactionTask extends BaseStepExecutionTask<SolanaTaskExtra> {
  readonly type = 'SOLANA_WAIT_FOR_TRANSACTION'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<SolanaTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<SolanaTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTransaction: any // TODO: type this
    }
  ): Promise<TaskResult> {
    const { client, step, statusManager, fromChain, isBridgeExecution } =
      context
    const { signedTransaction } = payload

    if (!signedTransaction) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Signed transaction is missing.'
      )
    }

    const wireTransaction = getBase64EncodedWireTransaction(signedTransaction)

    const simulationResult = await callSolanaWithRetry(client, (connection) =>
      connection
        .simulateTransaction(wireTransaction, {
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
