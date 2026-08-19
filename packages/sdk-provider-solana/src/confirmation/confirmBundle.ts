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

/**
 * How often this poller re-reads `getBundleStatuses`.
 *
 * Deliberately slower than the signature poller's 400 ms: Jito's own block
 * engine documents a default rate limit of 1 request per second per IP per
 * region, and 400 ms polling (2.5 req/s) exceeds it on its own. At 2 s this
 * poller holds 0.5 req/s, and with the deadline's `isBlockhashValid` probes
 * (≤0.15 req/s) on the same endpoint the branch stays under ~0.65 req/s.
 * Integrator-supplied Jito-capable providers (the only way this path runs —
 * the default LI.FI RPC set contains none) have their own, unverified limits;
 * this cadence is chosen for the strictest documented one. A bundle lands
 * within a slot or two of acceptance, so the coarser cadence costs at most
 * ~2 s of happy-path latency.
 */
const BUNDLE_POLL_INTERVAL_MS = 2_000

export type BundleConfirmation = {
  bundleId: string
  txSignatures: Signature[]
  signatureResults: readonly (SignatureStatus | null)[]
  /**
   * The bundle-level `err` field of the confirming `getBundleStatuses`
   * response, verbatim. Jito encodes it as a Rust `Result`: a landed bundle
   * carries `{ Ok: null }`, so a truthiness check must never be applied to
   * it. Carried so the defence-in-depth scan in
   * `SolanaJitoWaitForTransactionTask` still has something to read when
   * `signatureResults` degraded to all-`null` (see below).
   */
  bundleErr: unknown
}

/**
 * Confirms one Jito bundle against one Jito RPC.
 *
 * Bundles are submitted once, so there is no resend loop. `send` is still owned
 * by this module rather than by the caller, so the deadline can start before
 * the bundle is submitted: `BRANCH_TIMEOUT_MS` starts when `raceRpcs` is
 * entered, and a `sendBundle` slower than the gap between the two would
 * otherwise eat the margin that protects the final probe.
 *
 * A `send` failure throws out of the branch, which `raceRpcs` buckets as
 * `rpc-unavailable`.
 *
 * `readBundle` serves both the loop body and the final probe, so the two can
 * never disagree about what a missing `getSignatureStatuses` payload means.
 */
export async function confirmBundle(options: {
  rpc: JitoRpcType
  signal: AbortSignal
  lifetimes: TransactionLifetime[]
  send: () => Promise<string>
  /** Reports that this RPC accepted the bundle submission. */
  onBroadcast?: () => void
}): Promise<ConfirmationOutcome<BundleConfirmation>> {
  const { rpc, signal, lifetimes, send } = options
  const deadline = createConfirmationDeadline({ lifetimes, rpc })

  const bundleId = await send()
  options.onBroadcast?.()

  const readBundle = async (): Promise<BundleConfirmation | null> => {
    const statusResponse = await rpc
      .getBundleStatuses([bundleId])
      .send({ abortSignal: signal })
    // Guarded like the `getSignatureStatuses` payload below: a `{ value:
    // null }` answer is an endpoint that responded but said nothing, not a
    // failed read, so it must poll again rather than throw a `TypeError`
    // into the read-failure budget.
    const bundleStatus = statusResponse?.value?.[0]
    if (
      !bundleStatus ||
      !isConfirmedCommitment(bundleStatus.confirmation_status)
    ) {
      return null
    }

    const txSignatures = bundleStatus.transactions

    // The bundle status above is the atomic fact: a bundle executes in a
    // single slot, all of it or none of it, so `confirmed`/`finalized` means
    // every transaction in it landed. `getSignatureStatuses` only enriches
    // the confirmation with per-transaction `err` details for the
    // defence-in-depth scan in `SolanaJitoWaitForTransactionTask`. An
    // unusable response — a missing payload or a failed read — therefore
    // degrades to all-`null` results; it must never veto a confirmation the
    // bundle status already made, because that would report a landed bundle
    // as expired.
    let signatureResults: BundleConfirmation['signatureResults']
    try {
      const sigResponse = await rpc
        .getSignatureStatuses(txSignatures)
        .send({ abortSignal: signal })
      signatureResults = sigResponse?.value ?? txSignatures.map(() => null)
    } catch (_) {
      signatureResults = txSignatures.map(() => null)
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
