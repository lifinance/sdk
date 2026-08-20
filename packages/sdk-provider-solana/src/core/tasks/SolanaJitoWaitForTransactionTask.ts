import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { getSignatureFromTransaction } from '@solana/kit'
import { sendAndConfirmBundle } from '../../actions/sendAndConfirmBundle.js'
import type { SolanaStepExecutorContext } from '../../types.js'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'
import { unwrapConfirmation } from './unwrapConfirmation.js'

/** Jito encodes `err` as a Rust `Result`: a landed bundle carries
 * `{ Ok: null }`, so only an explicit `{ Err: … }` counts as a failure. */
function getBundleFailure(err: unknown): { failure: unknown } | undefined {
  if (typeof err !== 'object' || err === null || !('Err' in err)) {
    return undefined
  }
  return { failure: (err as { Err: unknown }).Err }
}

export class SolanaJitoWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const {
      client,
      step,
      statusManager,
      fromChain,
      isBridgeExecution,
      signedTransactions: contextSignedTransactions,
    } = context

    const signedTransactions = contextSignedTransactions ?? []

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

    if (!signedTransactions.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Signed transactions are not found.'
      )
    }

    // Derived from the signed transaction, matching the early `txHash` write.
    // The RPC's own list is never read - its order is Jito's to choose.
    const txSignature = getSignatureFromTransaction(signedTransactions[0])
    const txLink = `${fromChain.metamask.blockExplorerUrls[0]}tx/${txSignature}`

    // Use Jito bundle for transaction submission. An empty Jito RPC list -
    // the configuration gap, as opposed to an outage - throws inside
    // `sendAndConfirmBundle` with its own message, before anything is sent.
    const result = await sendAndConfirmBundle(client, signedTransactions, {
      // The explorer link is written the moment the first Jito RPC accepts
      // the submission - not at signing time, when the bundle may never be
      // broadcast at all (a failed send, or the configuration gap above).
      onBroadcast: () => {
        statusManager.updateAction(step, action.type, 'PENDING', {
          txLink,
        })
      },
    })

    // The `rpc-unavailable` message is distinct from the empty-list throw
    // above: RPCs were configured and every one of them failed. That is an
    // outage, and the collected branch errors say what each endpoint did.
    const bundleResult = unwrapConfirmation(result, {
      rpcUnavailable:
        'Unable to confirm bundle: every configured Jito RPC failed.',
      notConfirmed: 'Bundle was not confirmed before the SDK stopped waiting.',
      allRpcsFailed: 'All Jito RPCs failed',
      someRpcsFailed:
        'Some Jito RPCs failed while the confirmation window was open',
    })

    // A bundle is atomic, so reaching here means every transaction landed. A
    // `null` in `signatureResults` is indexing lag, never failure - treating
    // it as one reported completed swaps as `TransactionFailed`. A reported
    // `err` is the only real failure signal; the bundle-level one comes first
    // because it survives a failed `getSignatureStatuses` read.
    const bundleFailure = getBundleFailure(bundleResult.bundleErr)
    if (bundleFailure) {
      const cause = new SolanaTransactionDetailsError(bundleFailure.failure)
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${cause.message}`,
        cause
      )
    }

    const failedResult = bundleResult.signatureResults.find(
      (signatureResult) => signatureResult?.err
    )
    if (failedResult?.err) {
      const cause = new SolanaTransactionDetailsError(failedResult.err)
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        `Transaction failed: ${cause.message}`,
        cause
      )
    }

    // Transaction has been confirmed and we can update the action
    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: txSignature,
      txLink,
    })

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
