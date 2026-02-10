import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type SDKClient,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import {
  getBase64EncodedWireTransaction,
  getTransactionCodec,
  type Transaction,
} from '@solana/kit'
import type { SolanaSignTransactionOutput } from '@solana/wallet-standard-features'
import { sendAndConfirmBundle } from '../actions/sendAndConfirmBundle.js'
import { sendAndConfirmTransaction } from '../actions/sendAndConfirmTransaction.js'
import { callSolanaRpcsWithRetry } from '../rpc/utils.js'
import type { SolanaTaskExtra } from './types.js'

type ConfirmedTransactionResult = {
  txSignature: string
  bundleId?: string
}

const shouldUseJitoBundle = (
  client: SDKClient,
  transactions: Transaction[]
): boolean => {
  const routeOptions = client.config.routeOptions as
    | Record<string, unknown>
    | undefined
  const isJitoBundleEnabled = Boolean(routeOptions?.jitoBundle)

  if (transactions.length > 1 && !isJitoBundleEnabled) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      `Received ${transactions.length} transactions but Jito bundle is not enabled. Enable Jito bundle in routeOptions to submit multiple transactions.`
    )
  }

  return transactions.length > 1 && isJitoBundleEnabled
}

export class SolanaWaitForTransactionTask extends BaseStepExecutionTask<SolanaTaskExtra> {
  override async shouldRun(
    context: TaskContext<SolanaTaskExtra>,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: TaskContext<SolanaTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTransactionOutputs: SolanaSignTransactionOutput[]
    }
  ): Promise<TaskResult> {
    const { client, step, statusManager, fromChain, isBridgeExecution } =
      context
    const { signedTransactionOutputs } = payload

    const transactionCodec = getTransactionCodec()

    // Decode all signed transactions
    const signedTransactions: Transaction[] = signedTransactionOutputs.map(
      (output) => transactionCodec.decode(output.signedTransaction)
    )

    const useJitoBundle = shouldUseJitoBundle(client, signedTransactions)

    let confirmedTransaction: ConfirmedTransactionResult

    if (useJitoBundle) {
      // Use Jito bundle for transaction submission
      const bundleResult = await sendAndConfirmBundle(
        client,
        signedTransactions
      )

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

      confirmedTransaction = {
        txSignature: bundleResult.txSignatures[0],
        bundleId: bundleResult.bundleId,
      }
    } else {
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

      confirmedTransaction = {
        txSignature: result.txSignature,
      }
    }

    // Transaction has been confirmed and we can update the action
    action = statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: confirmedTransaction.txSignature,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${confirmedTransaction.txSignature}`,
    })

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
