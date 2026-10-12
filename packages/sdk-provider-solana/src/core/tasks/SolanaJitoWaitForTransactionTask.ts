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
  failureOf,
  getTxLink,
  sendAndSettle,
} from './transactionOutcome.js'

// The `rpc-unavailable` message is distinct from the empty-list throw inside
// `sendAndConfirmBundle`: RPCs were configured and every one of them failed.
// Every read RPC confirms and waits for the one shared submission, so a
// refused submission fails every branch with the same error.
const MESSAGES: ConfirmationMessages = {
  rpcUnavailable:
    'Unable to confirm bundle: every configured Solana RPC failed.',
  notConfirmed: 'Bundle was not confirmed before the SDK stopped waiting.',
  allRpcsFailed: 'All Solana RPCs failed',
  someRpcsFailed:
    'Some Solana RPCs failed while the confirmation window was open',
}

/** The failure of a landed bundle, if any: the first transaction `err`. */
function bundleFailureOf(
  confirmation: BundleConfirmation
): { err: unknown } | undefined {
  return confirmation.signatureResults.map(failureOf).find(Boolean)
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
      // Nothing left the SDK: the bytes go, so "Try again" signs again.
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
 * of `sendAndSettle`, on the first run and on a resume alike. A Jito bundle
 * lands whole or not at all, so the first transaction's signature stands for
 * it. A sender that is not Jito can land the transactions one by one; a
 * lookup by the first signature then misses a partial landing.
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
      // expiry goes out only inside the resend age cap. Past it nothing is
      // sent, and the outcome stays unknown until the dropped rule holds.
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
