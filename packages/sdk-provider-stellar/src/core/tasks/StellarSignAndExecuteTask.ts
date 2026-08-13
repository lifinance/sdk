import {
  BaseStepExecutionTask,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'
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

    const transactionRequestData = await getTransactionRequestData(
      step,
      executionOptions
    )

    checkWallet(step)

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
      txHash: transactionHash,
      txLink: getStellarTxLink(fromChain, transactionHash),
      txHex: signedTxXdr,
      signedAt: Date.now(),
    })

    await submitStellarTransaction(client, signedTxXdr, networkPassphrase)

    return { status: 'COMPLETED', context: { transactionHash } }
  }
}
