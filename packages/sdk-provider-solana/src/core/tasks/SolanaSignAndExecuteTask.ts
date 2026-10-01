import {
  assertNoOpenTransaction,
  BaseStepExecutionTask,
  CLEARED_TRANSACTION_FIELDS,
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
import { encodeStoredTransactions } from '../../utils/storedTransactions.js'
import { readSignature } from './readSignature.js'

export class SolanaSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      wallet,
      getWalletAccount,
      statusManager,
      executionOptions,
      isBridgeExecution,
    } = context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    // Defence in depth: the selector sends an action with an open
    // transaction to the wait task. Signing here could put a second
    // transaction on chain while the first can still land.
    assertNoOpenTransaction(action)

    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    // Resolved here and not in `createContext`: a resume that only waits
    // never signs, so it must not fail because the wallet has not
    // reconnected yet.
    const walletAccount = getWalletAccount(step)

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

    // Neither `txHash` nor `txLink` is written here. A signature is fixed at
    // signing, but the transaction does not exist yet: `getTransaction`
    // returns `null` for it, and simulation, the empty-Jito-RPC throw and
    // every send failure all sit between this task and the first broadcast.
    // The wait tasks write both on `onBroadcast`, when an RPC has accepted it.
    //
    // The previous transaction's fields (`CLEARED_TRANSACTION_FIELDS`:
    // `txHash`, `txLink`, `txHex`, `txFinal`, `taskId`) are cleared
    // explicitly. Only a final failure reaches this task with them set, and a
    // stale hash would look open again once its `txFinal` is gone (spec
    // 4.2.1). This write runs BEFORE the decode below, which can throw on a
    // malformed wallet output and would otherwise strand the old fields.
    statusManager.updateAction(step, action.type, 'PENDING', {
      ...CLEARED_TRANSACTION_FIELDS,
      signedAt: Date.now(),
    })

    const transactionCodec = getTransactionCodec()

    // Decode all signed transactions
    const signedTransactions = signedTransactionOutputs.map((output) =>
      transactionCodec.decode(output.signedTransaction)
    )

    // Every transaction must carry its fee payer signature before its bytes
    // are stored (spec 4.2.9): an unreadable value would fail every resume
    // the same way. Nothing has been sent yet, so the `TransactionUnprepared`
    // this throws leaves "Try again" free to sign again.
    for (const signedTransaction of signedTransactions) {
      readSignature(signedTransaction)
    }

    // Stored before any send: a reload from here on resends these bytes
    // instead of asking the wallet again. A bundle stays a JSON array, which
    // is how a resume knows to submit it with `sendBundle`.
    statusManager.updateAction(step, action.type, 'PENDING', {
      txHex: encodeStoredTransactions(
        signedTransactionOutputs.map((output) => output.signedTransaction),
        isBundleExecution
      ),
    })

    return {
      status: 'COMPLETED',
      context: { signedTransactions, isBundleExecution },
    }
  }
}
