import type { Signature } from '@solana/kit'
import type { SolanaRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'
import { createConfirmationDeadline } from './createConfirmationDeadline.js'
import { pollUntilDeadline } from './pollUntilDeadline.js'
import {
  type ConfirmationOutcome,
  isConfirmedCommitment,
  type SignatureStatus,
} from './types.js'

/** Slower than the signature poller's 400 ms, to spend fewer requests: the
 * bundle is never resent, so a slower read delays only the verdict, by 2 s at
 * most. `STATUS_RETRY_BACKOFF_CAP_MS` is set against this value. */
export const BUNDLE_POLL_INTERVAL_MS = 2_000

export type BundleConfirmation = {
  /** One confirmed status per bundle transaction, in bundle order. */
  signatureResults: readonly SignatureStatus[]
}

/**
 * Confirms one Jito bundle against one RPC, by the signatures of its
 * transactions. Every Solana RPC can read them, and a bundle lands whole in
 * one slot, so one read shows all of them confirmed.
 *
 * Bundles submit once, so there is no resend loop. `send` is owned here so the
 * deadline starts before submission rather than after it. A `send` failure
 * throws, which `raceRpcs` buckets as `rpc-unavailable`.
 */
export async function confirmBundle(options: {
  rpc: SolanaRpcType
  signal: AbortSignal
  /** The signatures of the bundle's transactions, in bundle order. */
  signatures: Signature[]
  lifetimes: TransactionLifetime[]
  /** Its answer is not read: senders answer `sendBundle` in different
   * shapes, and the signatures are known before the send. */
  send: () => Promise<unknown>
  /**
   * Reports that the shared submission was accepted. Must not throw -
   * `sendAndConfirmBundle` contains any throw from the integrator callback it
   * wraps, because a throw here would reject a branch whose bundle a submit
   * RPC had already accepted.
   */
  onBroadcast?: () => void
}): Promise<ConfirmationOutcome<BundleConfirmation>> {
  const { rpc, signal, signatures, lifetimes, send } = options
  const deadline = createConfirmationDeadline({ lifetimes, rpc })

  await send()
  // Guarded like `confirmSignature`'s send sites: the caller's once-guard
  // latches only after the callback returns, so a throwing integrator hook
  // leaves it open and a late `sendBundle` fulfilment would re-write a
  // finalized action back to PENDING.
  if (!signal.aborted) {
    options.onBroadcast?.()
  }

  const readBundle = async (): Promise<BundleConfirmation | null> => {
    const response = await rpc
      .getSignatureStatuses(signatures)
      .send({ abortSignal: signal })
    // A `{ value: null }`, non-array or short answer responded but said
    // nothing - poll again rather than throw a `TypeError` into the
    // read-failure budget.
    const statuses = response?.value
    return Array.isArray(statuses) &&
      statuses.length === signatures.length &&
      statuses.every(
        (status: SignatureStatus | null): status is SignatureStatus =>
          isConfirmedCommitment(status?.confirmationStatus)
      )
      ? { signatureResults: statuses }
      : null
  }

  return pollUntilDeadline({
    deadline,
    signal,
    pollIntervalMs: BUNDLE_POLL_INTERVAL_MS,
    probe: readBundle,
    read: 'bundle status read',
    subject: 'bundle',
  })
}
