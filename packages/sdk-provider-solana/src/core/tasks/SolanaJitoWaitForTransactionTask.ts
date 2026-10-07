import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Signature, Transaction } from '@solana/kit'
import { sendAndConfirmBundle } from '../../actions/sendAndConfirmBundle.js'
import type { BundleConfirmation } from '../../confirmation/confirmBundle.js'
import type { RaceResult } from '../../confirmation/raceRpcs.js'
import type { SolanaStepExecutorContext } from '../../types.js'
import {
  getTransactionLifetime,
  type TransactionLifetime,
} from '../../utils/getTransactionLifetime.js'
import type { ConfirmationMessages } from './confirmationError.js'
import { readSignature } from './readSignature.js'
import { resumeFromStore } from './resumeFromStore.js'
import {
  canResendStored,
  clearStoredTransactions,
  getTxLink,
  sendAndSettle,
} from './transactionOutcome.js'

// The `rpc-unavailable` message is distinct from the empty-list throw inside
// `sendAndConfirmBundle`: RPCs were configured and every one of them failed.
// That is an outage, and the collected branch errors say what each endpoint
// did.
const MESSAGES: ConfirmationMessages = {
  rpcUnavailable: 'Unable to confirm bundle: every configured Jito RPC failed.',
  notConfirmed: 'Bundle was not confirmed before the SDK stopped waiting.',
  allRpcsFailed: 'All Jito RPCs failed',
  someRpcsFailed:
    'Some Jito RPCs failed while the confirmation window was open',
}

/** Jito encodes `err` as a Rust `Result`: a landed bundle carries
 * `{ Ok: null }`, so only an explicit `{ Err: … }` counts as a failure. */
function getBundleFailure(err: unknown): { failure: unknown } | undefined {
  if (typeof err !== 'object' || err === null || !('Err' in err)) {
    return undefined
  }
  return { failure: (err as { Err: unknown }).Err }
}

/** The failure of a landed bundle, if any. A `null` in `signatureResults` is
 * indexing lag, never failure. The bundle-level `err` is checked first: it
 * survives a failed `getSignatureStatuses` read. */
function bundleFailureOf(
  confirmation: BundleConfirmation
): { err: unknown } | undefined {
  const bundleFailure = getBundleFailure(confirmation.bundleErr)
  if (bundleFailure) {
    return { err: bundleFailure.failure }
  }
  const failedResult = confirmation.signatureResults.find(
    (signatureResult) => signatureResult?.err
  )
  return failedResult?.err ? { err: failedResult.err } : undefined
}

export class SolanaJitoWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const { step, statusManager, isBridgeExecution, signedTransactions } =
      context

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

    // Resume mode: the sign task did not run in this session, so the signed
    // bundle comes from `txHex`, or only the first hash from `txHash`.
    if (!signedTransactions) {
      return resumeFromStore(context, action, {
        messages: MESSAGES,
        // Submitted once, as on the first run.
        send: (stored, lifetimes) =>
          sendSigned(context, action, {
            transactions: stored.transactions,
            signature: stored.signature,
            lifetimes,
            resuming: true,
          }),
      })
    }

    if (!signedTransactions.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Signed transactions are not found.'
      )
    }

    let txSignature: Signature
    try {
      txSignature = readSignature(signedTransactions[0])
    } catch (error) {
      // Nothing left the SDK: the bytes go, so "Try again" signs again
      // (spec 4.2.9).
      clearStoredTransactions(context, action)
      throw error
    }

    const lifetimes = await Promise.all(
      signedTransactions.map((transaction) =>
        getTransactionLifetime(transaction)
      )
    )

    return sendSigned(context, action, {
      transactions: signedTransactions,
      signature: txSignature,
      lifetimes,
      resuming: false,
    })
  }
}

/**
 * Submits the signed bundle once, confirms it and applies the result rules
 * (spec 4.4.6), on the first run and on a resume alike. A bundle lands whole
 * or not at all, so the first transaction's signature stands for it.
 */
function sendSigned(
  context: SolanaStepExecutorContext,
  action: ExecutionAction,
  options: {
    transactions: Transaction[]
    signature: Signature
    lifetimes: TransactionLifetime[]
    /** An earlier run may already have submitted this bundle. */
    resuming: boolean
  }
): Promise<TaskResult> {
  const { client, step, statusManager } = context
  const { transactions, signature, lifetimes, resuming } = options
  const txLink = getTxLink(context, signature)

  return sendAndSettle(context, action, {
    signature,
    send: async (): Promise<RaceResult<BundleConfirmation>> => {
      // Read right before the one submission: a bundle without its own
      // expiry goes out only inside the resend age cap (spec 4.2.8). Past
      // it nothing is sent, and the outcome stays unknown until the dropped
      // rule holds.
      if (!canResendStored(lifetimes, step.execution?.signedAt)) {
        return {
          kind: 'not-confirmed',
          errors: [
            new Error(
              'The resend age cap has passed; the stored bundle is not sent.'
            ),
          ],
        }
      }
      // An empty Jito RPC list - the configuration gap, as opposed to an
      // outage - throws inside `sendAndConfirmBundle` with its own message,
      // before anything is submitted.
      return sendAndConfirmBundle(client, transactions, {
        onBroadcast: () => {
          // The earliest honest point for both: an RPC has accepted the
          // transaction, so the signature now resolves on chain.
          statusManager.updateAction(step, action.type, 'PENDING', {
            txHash: signature,
            txLink,
          })
        },
      })
    },
    confirmedFailure: bundleFailureOf,
    resuming,
    messages: MESSAGES,
  })
}
