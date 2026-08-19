import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  RPCError,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { getSignatureFromTransaction } from '@solana/kit'
import { sendAndConfirmBundle } from '../../actions/sendAndConfirmBundle.js'
import type { SolanaStepExecutorContext } from '../../types.js'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'

/**
 * Extracts the failure payload from a bundle-level `err`, which Jito encodes
 * as a serialized Rust `Result`: a landed bundle carries `{ Ok: null }` -
 * truthy, so a truthiness check would fail every landed bundle - and a failed
 * one `{ Err: <payload> }`. Only that explicit `Err` shape is treated as a
 * failure; `null`, `{ Ok: null }` and anything unrecognized fall through,
 * because this scan is defence in depth on a bundle whose status already
 * confirmed, and an unknown shape must not veto a landed bundle.
 */
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

    // Derived from the signed transaction itself, with the same pure function
    // `SolanaSignAndExecuteTask` used for the early `txHash` write, so the two
    // writers cannot disagree. The RPC's own signature list is never read;
    // the order of its entries is Jito's to choose.
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

    if (result.kind === 'rpc-unavailable') {
      // Distinct from the empty-list throw above: RPCs were configured and
      // every one of them failed. That is an outage, and the collected
      // branch errors say what each endpoint did.
      throw new RPCError(
        LiFiErrorCode.RpcUnavailable,
        'Unable to confirm bundle: every configured Jito RPC failed.',
        result.errors.length
          ? new AggregateError(result.errors, 'All Jito RPCs failed')
          : undefined
      )
    }

    if (result.kind === 'not-confirmed') {
      // The verdict came from a branch that polled to its deadline and saw
      // nothing, but other branches may have died trying - and their errors
      // are the only trail explaining, say, an endpoint that never answered.
      throw new TransactionError(
        LiFiErrorCode.TransactionExpired,
        'Bundle was not confirmed before the SDK stopped waiting.',
        result.errors.length
          ? new AggregateError(
              result.errors,
              'Some Jito RPCs failed while the confirmation window was open'
            )
          : undefined
      )
    }

    const bundleResult = result.value

    // A Jito bundle is atomic: it executes in a single slot, all of it or none
    // of it. Reaching this point means `getBundleStatuses` reported the bundle
    // `confirmed` or `finalized`, so every transaction in it landed. A `null`
    // entry in `signatureResults` therefore says only that this RPC has not
    // indexed that signature yet - it is never evidence of a failed
    // transaction, because a bundle holding a failed transaction would not have
    // landed at all. Treating a `null` as a failure reported a completed swap
    // as `TransactionFailed`.
    //
    // A reported `err` is the one real failure signal, and it is still scanned
    // below as defence in depth. The bundle-level `err` comes first: it rides
    // the same `getBundleStatuses` response that confirmed the bundle, so it
    // is still readable when a failed `getSignatureStatuses` read degraded
    // `signatureResults` to all-`null` and left the per-signature scan
    // nothing to see.
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
