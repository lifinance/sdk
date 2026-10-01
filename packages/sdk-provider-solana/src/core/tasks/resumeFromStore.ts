import {
  type ExecutionAction,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Signature } from '@solana/kit'
import { lookupSignatureStatus } from '../../actions/lookupSignatureStatus.js'
import { isConfirmedCommitment } from '../../confirmation/types.js'
import type { SolanaStepExecutorContext } from '../../types.js'
import {
  getTransactionLifetime,
  type TransactionLifetime,
} from '../../utils/getTransactionLifetime.js'
import {
  decodeStoredTransactions,
  type StoredTransactions,
} from '../../utils/storedTransactions.js'
import {
  canResendStored,
  clearStoredTransactions,
  failureOf,
  recordLanded,
  resolveUnconfirmed,
} from './transactionOutcome.js'
import {
  type ConfirmationMessages,
  confirmationError,
} from './unwrapConfirmation.js'

/** What a resumed wait task can work from. */
type ResumeSource =
  /** Signed bytes that may still need to be sent. */
  | { kind: 'bytes'; stored: StoredTransactions }
  /** A broadcast signature alone: a route stored before the upgrade, or
   * bytes that no longer decode. */
  | { kind: 'hash'; signature: Signature }
  /** Bytes whose first signature is not the stored txHash (damaged
   * storage). They prove nothing about that transaction, and they may have
   * been sent: nothing is sent and nothing is dropped. */
  | { kind: 'mismatch'; signature: Signature }

function readResumeSource(
  context: SolanaStepExecutorContext,
  action: ExecutionAction
): ResumeSource {
  if (action.txHex) {
    const stored = decodeStoredTransactions(action.txHex)
    if (stored) {
      if (action.txHash && action.txHash !== stored.signature) {
        return { kind: 'mismatch', signature: action.txHash as Signature }
      }
      return { kind: 'bytes', stored }
    }
    // The sign task stores only bytes that decode, so these were damaged
    // after the write - by the integrator's storage, say. They would fail
    // every resume the same way (spec 4.2.9).
    clearStoredTransactions(context, action)
  }

  if (action.txHash) {
    return { kind: 'hash', signature: action.txHash as Signature }
  }

  // Without a hash no RPC ever accepted a send - `txHash` is written on the
  // first accepted one - so nothing can land. No final marker: "Try again"
  // signs again.
  throw new TransactionError(
    LiFiErrorCode.TransactionUnprepared,
    'Unable to prepare transaction. Signed transactions are not found.'
  )
}

/**
 * Resume mode of both wait tasks (spec 4.4.5): the sign task did not run in
 * this session, so the transaction comes from the action.
 *
 * 1. Look the signature up on every RPC. A confirmed status goes straight to
 *    the result rules: the transaction may have landed after the page closed.
 *    This look only has to find, so it asks for no canary.
 * 2. Otherwise resend the stored bytes through `send` when that is allowed -
 *    the task's normal send path, without simulation.
 * 3. Otherwise - a hash alone, or bytes past the resend age cap - nothing is
 *    sent, and only the dropped rule can make the outcome final.
 *
 * Bytes that are not the stored txHash's transaction are never sent, and the
 * dropped rule never runs for them: the outcome stays unknown unless the
 * lookup by txHash finds it confirmed.
 */
export async function resumeFromStore(
  context: SolanaStepExecutorContext,
  action: ExecutionAction,
  options: {
    messages: ConfirmationMessages
    /** Sends the stored bytes and applies the result rules, as the first
     * run does, but never simulates: a transaction that already landed, or
     * funds it already spent, would fail the simulation falsely. */
    send: (
      stored: StoredTransactions,
      lifetimes: TransactionLifetime[]
    ) => Promise<TaskResult>
  }
): Promise<TaskResult> {
  const { client, step } = context
  const source = readResumeSource(context, action)
  const signature =
    source.kind === 'bytes' ? source.stored.signature : source.signature

  const lookup = await lookupSignatureStatus(client, signature)
  if (
    lookup.kind === 'found' &&
    isConfirmedCommitment(lookup.status.confirmationStatus)
  ) {
    return recordLanded(context, action, {
      signature,
      failure: failureOf(lookup.status),
    })
  }

  const lifetimes =
    source.kind === 'bytes'
      ? await Promise.all(
          source.stored.transactions.map((transaction) =>
            getTransactionLifetime(transaction)
          )
        )
      : []

  // A `processed` status resends too: a signature executes at most once.
  if (
    source.kind === 'bytes' &&
    canResendStored(lifetimes, step.execution?.signedAt)
  ) {
    return options.send(source.stored, lifetimes)
  }

  // No RPC answered at all: an outage, as today. Otherwise the transaction
  // was simply not seen.
  const silent = lookup.kind === 'unknown' && !lookup.answered
  const error = confirmationError(
    silent
      ? { kind: 'rpc-unavailable', errors: lookup.errors }
      : { kind: 'not-confirmed', errors: [] },
    options.messages
  )
  if (source.kind === 'mismatch') {
    // Damaged storage: no dropped rule, so the outcome stays unknown.
    throw error
  }
  const status = await resolveUnconfirmed(context, action, {
    signature,
    error,
    expiredAtSlot: undefined,
    messages: options.messages,
  })
  return recordLanded(context, action, {
    signature,
    failure: failureOf(status),
  })
}
