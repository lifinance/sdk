import type { Signature } from '@solana/kit'
import type { JitoRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'
import { createConfirmationDeadline } from './createConfirmationDeadline.js'
import { pollUntilDeadline } from './pollUntilDeadline.js'
import {
  type ConfirmationOutcome,
  isConfirmedCommitment,
  type SignatureStatus,
} from './types.js'

/** Slower than the signature poller's 400 ms: Jito documents 1 req/s per IP
 * per region. At 2 s this holds 0.5 req/s, leaving room for the deadline's
 * blockhash probes on the same endpoint. */
export const BUNDLE_POLL_INTERVAL_MS = 2_000

export type BundleConfirmation = {
  /** The submission's own id, carried for diagnostics. */
  bundleId: string
  /** Never read for a `txHash` - its order is Jito's to choose. Kept so the
   * reversed-list regression stays expressible in the wait-task spec. */
  txSignatures: Signature[]
  signatureResults: readonly (SignatureStatus | null)[]
  /** Bundle-level `err`, verbatim. Jito encodes it as a Rust `Result`, so a
   * landed bundle carries `{ Ok: null }` - never truthiness-check it. */
  bundleErr: unknown
}

/**
 * Confirms one Jito bundle against one Jito RPC.
 *
 * Bundles submit once, so there is no resend loop. `send` is owned here so the
 * deadline starts before submission rather than after it. A `send` failure
 * throws, which `raceRpcs` buckets as `rpc-unavailable`.
 */
export async function confirmBundle(options: {
  rpc: JitoRpcType
  signal: AbortSignal
  lifetimes: TransactionLifetime[]
  send: () => Promise<string>
  /**
   * Reports that this RPC accepted the bundle submission. Must not throw -
   * `sendAndConfirmBundle` contains any throw from the integrator callback it
   * wraps, because a throw here would reject a branch whose bundle Jito had
   * already accepted.
   */
  onBroadcast?: () => void
}): Promise<ConfirmationOutcome<BundleConfirmation>> {
  const { rpc, signal, lifetimes, send } = options
  const deadline = createConfirmationDeadline({ lifetimes, rpc })

  const bundleId = await send()
  // No aborted-guard needed: a bundle branch cannot confirm without its own
  // `send` succeeding first, so a late fulfilment cannot move an action
  // status after the race settles.
  options.onBroadcast?.()

  const readBundle = async (): Promise<BundleConfirmation | null> => {
    const statusResponse = await rpc
      .getBundleStatuses([bundleId])
      .send({ abortSignal: signal })
    // A `{ value: null }` answer responded but said nothing - poll again
    // rather than throw a `TypeError` into the read-failure budget.
    const bundleStatus = statusResponse?.value?.[0]
    if (
      !bundleStatus ||
      !isConfirmedCommitment(bundleStatus.confirmation_status)
    ) {
      return null
    }

    // Unvalidated wire data: without this guard a confirmed status carrying
    // no `transactions` makes every `.map` below a `TypeError`, and a landed
    // bundle would report as `rpc-unavailable`.
    const txSignatures = bundleStatus.transactions ?? []

    // The bundle status is the atomic fact: a bundle lands whole or not at
    // all. `getSignatureStatuses` only enriches it with per-transaction `err`
    // detail, so an unusable response degrades to all-`null` and must never
    // veto a confirmation the status already made.
    let signatureResults: BundleConfirmation['signatureResults']
    if (txSignatures.length === 0) {
      // Nothing to enrich; the status already confirmed the bundle.
      signatureResults = []
    } else {
      try {
        const sigResponse = await rpc
          .getSignatureStatuses(txSignatures)
          .send({ abortSignal: signal })
        signatureResults = sigResponse?.value ?? txSignatures.map(() => null)
      } catch (_) {
        signatureResults = txSignatures.map(() => null)
      }
    }

    return {
      bundleId,
      txSignatures,
      signatureResults,
      bundleErr: bundleStatus.err,
    }
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
