import { sleep } from '@lifi/sdk'
import type { Signature } from '@solana/kit'
import type { JitoRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'
import {
  createConfirmationDeadline,
  MAX_PROBE_ERRORS,
  POLL_INTERVAL_MS,
} from './createConfirmationDeadline.js'
import {
  type ConfirmationOutcome,
  isConfirmedCommitment,
  type SignatureStatus,
} from './types.js'

export type BundleConfirmation = {
  bundleId: string
  txSignatures: Signature[]
  signatureResults: readonly (SignatureStatus | null)[]
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
}): Promise<ConfirmationOutcome<BundleConfirmation>> {
  const { rpc, signal, lifetimes, send } = options
  const deadline = createConfirmationDeadline({ lifetimes, rpc })

  const bundleId = await send()

  const readBundle = async (): Promise<BundleConfirmation | null> => {
    const statusResponse = await rpc
      .getBundleStatuses([bundleId])
      .send({ abortSignal: signal })
    const bundleStatus = statusResponse.value[0]
    if (
      !bundleStatus ||
      !isConfirmedCommitment(bundleStatus.confirmation_status)
    ) {
      return null
    }

    const txSignatures = bundleStatus.transactions
    const sigResponse = await rpc
      .getSignatureStatuses(txSignatures)
      .send({ abortSignal: signal })
    if (!sigResponse?.value) {
      return null
    }

    return {
      bundleId,
      txSignatures,
      signatureResults: sigResponse.value,
    }
  }

  let probeErrors = 0
  // "Did this RPC ever answer a bundle status read?" — a read that resolves
  // `null` still answered. Only this separates "polled and saw nothing" from
  // "never got a word out of this endpoint", and the two must never be
  // reported the same way.
  let probeSucceeded = false

  while (!deadline.reached() && !signal.aborted) {
    try {
      const confirmation = await readBundle()
      probeErrors = 0
      probeSucceeded = true
      if (confirmation) {
        return { kind: 'confirmed', value: confirmation }
      }
    } catch (error) {
      probeErrors += 1
      if (probeErrors >= MAX_PROBE_ERRORS) {
        throw error
      }
    }
    await sleep(POLL_INTERVAL_MS)
    await deadline.tick(signal)
  }

  // The bundle may have landed between the last poll and the deadline.
  if (!signal.aborted) {
    try {
      const confirmation = await readBundle()
      probeSucceeded = true
      if (confirmation) {
        return { kind: 'confirmed', value: confirmation }
      }
    } catch (_) {
      // One failed final probe is not evidence that this RPC is unusable.
    }
  }

  // Reached when every bundle status read hung until the branch was aborted:
  // one in-flight read is not `MAX_PROBE_ERRORS` consecutive failures, so the
  // loop above never threw. Returning `not-confirmed` here would report a hung
  // endpoint as an expired bundle.
  if (!probeSucceeded) {
    throw new Error(
      'No bundle status read against this RPC ever completed; the bundle was never observed here.'
    )
  }

  return { kind: 'not-confirmed' }
}
