import {
  assertNoOpenTransaction,
  BaseStepExecutionTask,
  CLEARED_TRANSACTION_FIELDS,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { Transaction } from '@mysten/sui/transactions'
import type { SuiStepExecutorContext } from '../../types.js'
import { getSuiTxLink } from '../../utils/getSuiTxLink.js'
import { serializeSuiSignedTransaction } from '../../utils/suiSignedTransaction.js'

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
      fromChain,
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

    // A transaction signed earlier for this action may still land. Signing a
    // second one could execute the swap twice.
    assertNoOpenTransaction(action)

    const transactionRequestData = await getTransactionRequestData(
      step,
      executionOptions
    )

    checkWallet(step)

    // Built and signed exactly as `suiClient.core.signAndExecuteTransaction`
    // does, in two steps: the signed bytes are stored before they are sent,
    // so a reload re-executes them instead of asking for a second signature.
    const transaction = Transaction.from(transactionRequestData)
    transaction.setSenderIfNotSet(signer.toSuiAddress())
    const transactionBytes = await transaction.build({ client: suiClient })

    const { signature } = await signer.signTransaction(transactionBytes)

    const txHex = serializeSuiSignedTransaction(transactionBytes, signature)
    if (!txHex) {
      // Nothing was sent yet, so "Try again" signs a new transaction.
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. The signed transaction is incomplete.'
      )
    }

    // One write: the previous transaction's data is cleared together with
    // storing the new bytes, so no stale hash can look open again.
    statusManager.updateAction(step, action.type, 'PENDING', {
      ...CLEARED_TRANSACTION_FIELDS,
      txHex,
      signedAt: Date.now(),
    })

    const {
      $kind,
      FailedTransaction,
      Transaction: TransactionResult,
    } = await suiClient.core.executeTransaction({
      transaction: transactionBytes,
      signatures: [signature],
    })

    // A failed transaction has a digest too: it is on chain.
    const executedTransaction = TransactionResult ?? FailedTransaction
    if (executedTransaction) {
      statusManager.updateAction(step, action.type, 'PENDING', {
        txHash: executedTransaction.digest,
        txLink: getSuiTxLink(fromChain, executedTransaction.digest),
      })
    }

    if ($kind !== 'Transaction' || !TransactionResult) {
      if (FailedTransaction) {
        // Executed and failed: the outcome is final and the bytes are spent.
        statusManager.updateAction(step, action.type, 'PENDING', {
          txHex: undefined,
        })
      }
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${FailedTransaction?.status.error ?? `Unexpected transaction result: ${$kind}`}`,
        undefined,
        FailedTransaction ? { final: true } : undefined
      )
    }

    return {
      status: 'COMPLETED',
      context: { signedTransaction: TransactionResult },
    }
  }
}
