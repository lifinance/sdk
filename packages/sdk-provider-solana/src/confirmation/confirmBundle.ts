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
 * Bundles are submitted once, so there is no resend loop. `readBundle` serves
 * both the loop body and the final probe, so the two can never disagree about
 * what a missing `getSignatureStatuses` payload means.
 */
export async function confirmBundle(options: {
  rpc: JitoRpcType
  signal: AbortSignal
  bundleId: string
  lifetimes: TransactionLifetime[]
}): Promise<ConfirmationOutcome<BundleConfirmation>> {
  const { rpc, signal, bundleId, lifetimes } = options
  const deadline = createConfirmationDeadline({ lifetimes, rpc })

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

  while (!deadline.reached() && !signal.aborted) {
    try {
      const confirmation = await readBundle()
      probeErrors = 0
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
      if (confirmation) {
        return { kind: 'confirmed', value: confirmation }
      }
    } catch (_) {
      // One failed final probe is not evidence that this RPC is unusable.
    }
  }

  return { kind: 'not-confirmed' }
}
