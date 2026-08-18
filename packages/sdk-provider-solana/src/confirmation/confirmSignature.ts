import { sleep } from '@lifi/sdk'
import type { Signature } from '@solana/kit'
import type { SolanaRpcType } from '../rpc/types.js'
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

const RESEND_INTERVAL_MS = 1000

/**
 * Confirms one transaction against one RPC.
 *
 * Holds no policy of its own: the deadline decides when to stop, and the
 * resend loop can only observe an `AbortSignal`. Nothing the resend loop does
 * can lengthen or shorten polling.
 */
export async function confirmSignature(options: {
  rpc: SolanaRpcType
  signal: AbortSignal
  signature: Signature
  lifetimes: TransactionLifetime[]
  resend: (rpc: SolanaRpcType, signal: AbortSignal) => Promise<void>
}): Promise<ConfirmationOutcome<SignatureStatus>> {
  const { rpc, signal, signature, lifetimes, resend } = options
  const deadline = createConfirmationDeadline({ lifetimes, rpc })

  // Ends the resend loop when this branch finishes. That loop can never change
  // *when* polling stops: the poll loop's exit depends on the deadline and the
  // caller's signal alone.
  const branch = new AbortController()
  const abortBranch = (): void => branch.abort()
  signal.addEventListener('abort', abortBranch, { once: true })

  let sendSucceeded = false

  // The first send is awaited so that "did this RPC ever accept the
  // transaction?" has a settled answer by the time the polling loop ends.
  // Leaving it to the detached loop makes that answer depend on microtask
  // ordering, which is exactly the kind of implicit coupling this rework
  // removes.
  try {
    await resend(rpc, signal)
    sendSucceeded = true
  } catch (_) {
    // Continue with confirmation even if the initial send fails — another RPC
    // may already have propagated the transaction.
  }

  const resending = (async () => {
    while (!branch.signal.aborted) {
      await sleep(RESEND_INTERVAL_MS)
      if (branch.signal.aborted) {
        break
      }
      try {
        await resend(rpc, branch.signal)
        sendSucceeded = true
      } catch (_) {
        // Resending is best-effort. A total failure is caught by the
        // sendSucceeded check below.
      }
    }
  })()
  resending.catch(() => {})

  const readStatus = async (): Promise<SignatureStatus | null> => {
    const response = await rpc
      .getSignatureStatuses([signature])
      .send({ abortSignal: signal })
    const status = response.value[0]
    if (status && isConfirmedCommitment(status.confirmationStatus)) {
      return status
    }
    return null
  }

  try {
    let probeErrors = 0

    while (!deadline.reached() && !signal.aborted) {
      try {
        const status = await readStatus()
        probeErrors = 0
        if (status) {
          return { kind: 'confirmed', value: status }
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

    // The transaction may have confirmed between the last poll and the
    // deadline being reached.
    if (!signal.aborted) {
      try {
        const status = await readStatus()
        if (status) {
          return { kind: 'confirmed', value: status }
        }
      } catch (_) {
        // The loop already ran. One failed final probe is not evidence that
        // this RPC is unusable.
      }
    }

    if (!sendSucceeded) {
      throw new Error(
        'Every transaction send attempt against this RPC failed; the transaction was never submitted here.'
      )
    }

    return { kind: 'not-confirmed' }
  } finally {
    branch.abort()
    signal.removeEventListener('abort', abortBranch)
  }
}
