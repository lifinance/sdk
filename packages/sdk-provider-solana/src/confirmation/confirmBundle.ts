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
 * poller holds 0.5 req/s. The deadline's `isBlockhashValid` probes add
 * ~k/7 req/s on the same endpoint — one request per distinct blockhash (k)
 * per probe, every `EXPIRY_PROBE_INTERVAL_MS` — so the common
 * single-blockhash bundle stays under ~0.65 req/s, and a bundle carrying
 * k ≥ 4 distinct blockhashes crosses the documented limit (at Jito's
 * 5-transaction bundle cap, at most ~1.21 req/s). That excess is accepted
 * rather than paced away: the only casualty of the resulting 429s is the
 * prober itself, which degrades to the wall-clock ceiling after
 * `MAX_PROBE_ERRORS` and never turns a throttled probe into a verdict,
 * while this poller keeps to its half of the budget. Scaling the probe
 * interval by k would keep the sum under 1 req/s, but it would push the
 * earliest possible expiry verdict from ~14.8 s to ~14.8·k s — gutting the
 * early exit exactly when several lifetimes are racing expiry.
 * Integrator-supplied Jito-capable providers (the only way this path runs —
 * the default LI.FI RPC set contains none) have their own, unverified limits;
 * this cadence is chosen for the strictest documented one. A bundle lands
 * within a slot or two of acceptance, so the coarser cadence costs at most
 * ~2 s of happy-path latency.
 */
export const BUNDLE_POLL_INTERVAL_MS = 2_000

export type BundleConfirmation = {
  /** The submission's own id, carried for diagnostics. */
  bundleId: string
  /**
   * The RPC's signature list, deliberately never read for a `txHash`: its
   * order is Jito's to choose, and reading `txSignatures[0]` reported the
   * wrong transaction's signature before this rework. Both wait tasks derive
   * the signature from the signed transaction instead. Carried so that
   * regression stays expressible - `SolanaJitoWaitForTransactionTask`'s
   * `reports the signature of the first signed transaction, not the
   * RPC-reported list` spec returns this list reversed, which is only a test
   * if the field exists.
   */
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
  // Unlike `confirmSignature`'s send sites, this call needs no aborted-guard:
  // a bundle branch cannot confirm without its own `send` having succeeded
  // first, so by the time any branch settles the race, the caller's
  // once-guard has already latched and a late fulfilment here can no longer
  // move an action status. (A branch whose send is still in flight has not
  // settled, so the all-settled verdicts cannot outrun this call either.)
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

    // Guarded for the same reason as the two payloads around it. Without
    // this, a confirmed status carrying no `transactions` makes every `.map`
    // below a `TypeError`, thrown out of the probe on every poll and charged
    // to the read-failure budget - so a landed bundle would be reported as
    // `rpc-unavailable`, the exact class of misreport this module exists to
    // remove. An absent list confirms the bundle with no per-transaction
    // detail; it never vetoes the atomic fact the status already established.
    const txSignatures = bundleStatus.transactions ?? []

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
    if (txSignatures.length === 0) {
      // No signatures to enrich with, and `getSignatureStatuses([])` is not
      // worth asking. The bundle status already confirmed the bundle.
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
