import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  RPCError,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { sendAndConfirmBundle } from '../../actions/sendAndConfirmBundle.js'
import type { SolanaStepExecutorContext } from '../../types.js'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'

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

    // Use Jito bundle for transaction submission
    const result = await sendAndConfirmBundle(client, signedTransactions)

    if (result.kind === 'rpc-unavailable') {
      throw new RPCError(
        LiFiErrorCode.RpcUnavailable,
        'Unable to confirm bundle: no Jito RPC returned a usable response.',
        result.errors.length
          ? new AggregateError(result.errors, 'All Jito RPCs failed')
          : undefined
      )
    }

    if (result.kind === 'not-confirmed') {
      throw new TransactionError(
        LiFiErrorCode.TransactionExpired,
        'Bundle has expired: it was not confirmed before its blockhash expired.'
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
    // below as defence in depth.
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

    const confirmedTransaction = {
      txSignature: bundleResult.txSignatures[0],
      bundleId: bundleResult.bundleId,
    }

    // Transaction has been confirmed and we can update the action
    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: confirmedTransaction.txSignature,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${confirmedTransaction.txSignature}`,
    })

    if (isBridgeExecution) {
      statusManager.updateAction(step, action.type, 'DONE')
    }

    return { status: 'COMPLETED' }
  }
}
