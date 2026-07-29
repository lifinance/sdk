import {
  BaseStepExecutionTask,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { type Transaction, TransactionBuilder } from '@stellar/stellar-sdk'
import type { StellarStepExecutorContext } from '../../types.js'
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

    // A Stellar transaction hash is derivable from the signed envelope, so it can
    // be recorded before the network ever sees it. Persisting it here means a
    // crash between submit and confirmation resumes by polling for this hash
    // instead of re-signing and double-spending the sequence number.
    const signedTransaction = TransactionBuilder.fromXDR(
      signedTxXdr,
      networkPassphrase
    ) as Transaction
    const transactionHash = signedTransaction.hash().toString('hex')

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
