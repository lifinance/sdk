import type { Signature } from '@solana/kit'
import type { SolanaRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'
import { abortableSleep } from './abortableSleep.js'
import { createConfirmationDeadline } from './createConfirmationDeadline.js'
import { pollUntilDeadline } from './pollUntilDeadline.js'
import {
  type ConfirmationOutcome,
  isConfirmedCommitment,
  type SignatureStatus,
} from './types.js'

const RESEND_INTERVAL_MS = 1000
/**
 * How often this poller re-reads `getSignatureStatuses`. The default Solana
 * RPCs tolerate 2.5 req/s of status reads; the Jito bundle poller runs slower
 * because its endpoints do not (see `confirmBundle`).
 */
export const SIGNATURE_POLL_INTERVAL_MS = 400

/** Confirms one transaction against one RPC. Holds no policy: the deadline
 * decides when to stop, and the resend loop only observes an `AbortSignal`. */
export async function confirmSignature(options: {
  rpc: SolanaRpcType
  signal: AbortSignal
  signature: Signature
  lifetimes: TransactionLifetime[]
  resend: (rpc: SolanaRpcType, signal: AbortSignal) => Promise<void>
  /**
   * Reports that this RPC accepted a send of the transaction. Must not throw -
   * `sendAndConfirmTransaction` contains any throw from the integrator
   * callback it wraps.
   */
  onBroadcast?: () => void
}): Promise<ConfirmationOutcome<SignatureStatus>> {
  const { rpc, signal, signature, lifetimes, resend } = options
  const deadline = createConfirmationDeadline({ lifetimes, rpc })

  // Ends the resend loop when this branch finishes.
  const branch = new AbortController()
  const abortBranch = (): void => branch.abort()
  signal.addEventListener('abort', abortBranch, { once: true })

  let sendSucceeded = false

  // Awaited so "did this RPC ever accept the transaction?" has a settled
  // answer by the time polling ends, rather than one that depends on
  // microtask ordering.
  try {
    await resend(rpc, signal)
    sendSucceeded = true
    // A send can fulfil after the abort; reporting a broadcast then would
    // regress an action status the wait task already finalized.
    // `sendSucceeded` still latches - the RPC did accept it.
    if (!signal.aborted) {
      options.onBroadcast?.()
    }
  } catch (_) {
    // Continue with confirmation even if the initial send fails — another RPC
    // may already have propagated the transaction.
  }

  const resending = (async () => {
    while (!branch.signal.aborted) {
      await abortableSleep(RESEND_INTERVAL_MS, branch.signal)
      if (branch.signal.aborted) {
        break
      }
      try {
        await resend(rpc, branch.signal)
        sendSucceeded = true
        // Same late-fulfilment guard as the first send.
        if (!branch.signal.aborted) {
          options.onBroadcast?.()
        }
      } catch (_) {
        // Resending is best-effort. A total failure is caught by the
        // neverBroadcast check in the verdict.
      }
    }
  })()
  resending.catch(() => {})

  const readStatus = async (): Promise<SignatureStatus | null> => {
    const response = await rpc
      .getSignatureStatuses([signature])
      .send({ abortSignal: signal })
    // A `{ value: null }` answer responded but said nothing - poll again
    // rather than throw a `TypeError` into the read-failure budget.
    const status = response?.value?.[0]
    if (status && isConfirmedCommitment(status.confirmationStatus)) {
      return status
    }
    return null
  }

  try {
    return await pollUntilDeadline({
      deadline,
      signal,
      pollIntervalMs: SIGNATURE_POLL_INTERVAL_MS,
      probe: readStatus,
      read: 'signature status read',
      subject: 'transaction',
      // Read at verdict time, not captured: the resend loop may succeed long
      // after the awaited first send failed.
      neverBroadcast: () => !sendSucceeded,
    })
  } finally {
    branch.abort()
    signal.removeEventListener('abort', abortBranch)
  }
}
