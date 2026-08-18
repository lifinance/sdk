import {
  BaseStepExecutionTask,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
  withTimeout,
} from '@lifi/sdk'
import { getSignatureFromTransaction, getTransactionCodec } from '@solana/kit'
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
      fromChain,
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

    // A Solana signature is fixed the moment the wallet signs, long before
    // anything reaches an RPC. Record it here rather than after the wait, so a
    // confirmation that fails - an unreachable RPC above all - still leaves the
    // caller the signature of a transaction that may well have landed. The
    // write reaches the live route object and any `updateRouteHook` the
    // integrator passed, and nothing later removes it - marking the action
    // `FAILED` only adds an `error`. So at the moment the wait gives up, a
    // user or an integrator can look the transaction up on chain before
    // signing a replacement.
    //
    // A restart is a separate matter, and not a reason this write exists: a
    // resumed route runs `prepareRestart`, which keeps only actions whose
    // status is not `FAILED`, and `BaseStepExecutor` marks the failing action
    // `FAILED` on every non-retry error. The actions array is therefore
    // emptied, `txHash` included. Carrying the signature across a retry needs
    // a change in `@lifi/sdk`.
    //
    // `signedTransactions[0]` is the transaction both wait tasks report:
    // the standard path derives its signature from this very object, and the
    // Jito path reports the first signature of the bundle submitted from it.
    //
    // The standard path cannot disagree with this write - it calls the same
    // pure function on the same object. The Jito path can: it reports what
    // `getBundleStatuses` returned, so the two agree only while Jito lists a
    // bundle's `transactions` in submission order. That is an assumption
    // about the RPC, not a property of this code, and no mock can test it.
    // What is tested is that the two writers pick the same index and the same
    // source - see `reports the same signature the sign task recorded before
    // the wait` in `SolanaJitoWaitForTransactionTask.unit.spec.ts`.
    const txSignature = getSignatureFromTransaction(signedTransactions[0])

    statusManager.updateAction(step, action.type, 'PENDING', {
      signedAt: Date.now(),
      txHash: txSignature,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txSignature}`,
    })

    return {
      status: 'COMPLETED',
      context: { signedTransactions, isBundleExecution },
    }
  }
}
