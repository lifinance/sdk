import {
  BaseStepExecutionTask,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
  withTimeout,
} from '@lifi/sdk'
import { getTransactionCodec } from '@solana/kit'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import type { SolanaStepExecutorContext } from '../../types.js'
import { base64ToUint8Array } from '../../utils/base64ToUint8Array.js'
import { getWalletFeature } from '../../utils/getWalletFeature.js'

export class SolanaSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      wallet,
      walletAccount,
      statusManager,
      executionOptions,
      isBridgeExecution,
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

    const transactionRequestData = (await getTransactionRequestData(
      step,
      executionOptions
    )) as string | string[]

    // The backend returns an array when it produced a Jito bundle and a string
    // for a single transaction. The shape determines how we submit it later:
    // array -> sendBundle, string -> sendTransaction.
    const isBundleExecution = Array.isArray(transactionRequestData)

    const transactionDataArray = isBundleExecution
      ? transactionRequestData
      : [transactionRequestData]

    const transactionBytesArray = transactionDataArray.map((data) =>
      base64ToUint8Array(data)
    )

    const signedTransactionOutputs = await withTimeout(
      async () => {
        const { signTransaction } = getWalletFeature(
          wallet,
          SolanaSignTransaction
        )
        // Spread the inputs to sign all transactions at once
        return signTransaction(
          ...transactionBytesArray.map((transaction) => ({
            account: walletAccount,
            transaction,
          }))
        )
      },
      {
        // https://solana.com/docs/advanced/confirmation#transaction-expiration
        // Use 2 minutes to account for fluctuations
        timeout: 120_000,
        errorInstance: new TransactionError(
          LiFiErrorCode.TransactionExpired,
          'Transaction has expired: blockhash is no longer recent enough.'
        ),
      }
    )

    if (signedTransactionOutputs.length === 0) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'No signed transaction returned from signer.'
      )
    }

    const transactionCodec = getTransactionCodec()

    // Decode all signed transactions
    const signedTransactions = signedTransactionOutputs.map((output) =>
      transactionCodec.decode(output.signedTransaction)
    )

    // Neither `txHash` nor `txLink` is written here. A signature is fixed at
    // signing, but the transaction does not exist yet: `getTransaction`
    // returns `null` for it, and simulation, the empty-Jito-RPC throw and
    // every send failure all sit between this task and the first broadcast.
    // The wait tasks write both on `onBroadcast`, when an RPC has accepted it.
    //
    // Both are still written as an explicit `undefined`, which clears what a
    // restarted `PENDING` action carried over from a previous run.
    // `prepareRestart` keeps that action *because* its `txHash` is truthy, so
    // leaving the signature in place would report the previous run's hash if
    // this run failed before its first broadcast.
    statusManager.updateAction(step, action.type, 'PENDING', {
      signedAt: Date.now(),
      txHash: undefined,
      txLink: undefined,
    })

    return {
      status: 'COMPLETED',
      context: { signedTransactions, isBundleExecution },
    }
  }
}
