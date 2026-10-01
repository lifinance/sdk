import {
  assertNoOpenTransaction,
  BaseStepExecutionTask,
  CLEARED_TRANSACTION_FIELDS,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'
import { classifySubmitFailure } from './helpers/classifySubmitFailure.js'
import { deriveTransactionHash } from './helpers/deriveTransactionHash.js'
import { getStellarTxLink } from './helpers/getStellarTxLink.js'
import { submitStellarTransaction } from './helpers/submitStellarTransaction.js'

export class StellarSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: StellarStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      wallet,
      fromChain,
      statusManager,
      executionOptions,
      networkPassphrase,
      isBridgeExecution,
      checkWallet,
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

    // Defence in depth: the selector never routes an open transaction here,
    // and signing again could execute the swap twice.
    assertNoOpenTransaction(action)

    const transactionRequestData = await getTransactionRequestData(
      step,
      executionOptions
    )

    checkWallet(step)

    // Checked again right before the wallet: a late write of an older run
    // can merge its transaction into this action during the await above.
    assertNoOpenTransaction(statusManager.findAction(step, action.type))

    const { signedTxXdr } = await wallet.signTransaction(
      transactionRequestData,
      {
        address: wallet.address,
        networkPassphrase,
      }
    )

    // Recorded before the network ever sees the envelope, so a crash between
    // submit and confirmation resumes by polling for this hash rather than
    // re-signing and executing the swap twice. StellarStepExecutor.createPipeline
    // relies on this ordering for its resume entry point.
    const transactionHash = deriveTransactionHash(
      signedTxXdr,
      networkPassphrase
    )

    statusManager.updateAction(step, action.type, 'PENDING', {
      // A new transaction: nothing of the previous one may survive, least of
      // all its `txFinal` verdict.
      ...CLEARED_TRANSACTION_FIELDS,
      txHash: transactionHash,
      txLink: getStellarTxLink(fromChain, transactionHash),
      txHex: signedTxXdr,
      signedAt: Date.now(),
    })

    try {
      await submitStellarTransaction(client, signedTxXdr, networkPassphrase)
    } catch (error) {
      // A rejection is final only with a chain proof that the envelope was never
      // applied and can no longer be, and when the LI.FI status API does not
      // know the hash. On the first run the envelope has usually not expired
      // yet, so the outcome stays unknown and a resume checks it again.
      throw await classifySubmitFailure(
        { client, step, transactionHash, signedTxXdr, networkPassphrase },
        error
      )
    }

    return { status: 'COMPLETED', context: { transactionHash } }
  }
}
