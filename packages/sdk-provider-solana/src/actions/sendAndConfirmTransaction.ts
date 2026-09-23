import type { SDKClient } from '@lifi/sdk'
import {
  type Commitment,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Transaction,
} from '@solana/kit'
import {
  confirmSignature,
  RESEND_INTERVAL_MS,
} from '../confirmation/confirmSignature.js'
import { BRANCH_TIMEOUT_MS } from '../confirmation/createConfirmationDeadline.js'
import { type RaceResult, raceRpcs } from '../confirmation/raceRpcs.js'
import type { SignatureStatus } from '../confirmation/types.js'
import { getSolanaRpcs, getSolanaWriteRpcs } from '../rpc/registry.js'
import type { SolanaRpcType } from '../rpc/types.js'
import { getTransactionLifetime } from '../utils/getTransactionLifetime.js'

/**
 * Sends a Solana transaction to every configured RPC and returns as soon as
 * one of them confirms it.
 *
 * With `writeRpcUrls`, the transaction is sent only through those RPCs, and
 * the configured RPCs only confirm it.
 *
 * The polling horizon comes from the signed transaction's own blockhash and a
 * wall-clock ceiling. It deliberately never comes from `getBlockHeight`: at
 * least one endpoint in the default LI.FI set answers that call with the slot
 * number.
 */
export async function sendAndConfirmTransaction(
  client: SDKClient,
  signedTransaction: Transaction,
  options?: {
    /** Runs once, when the first RPC accepts a send. */
    onBroadcast?: () => void
    /**
     * RPCs that send the transaction in place of the configured ones. They
     * receive no reads: status polling and the confirmation deadline stay on
     * the configured RPCs.
     */
    writeRpcUrls?: string[]
  }
): Promise<RaceResult<SignatureStatus>> {
  const solanaRpcs = await getSolanaRpcs(client)

  let broadcastReported = false
  // Distinct from `broadcastReported`, which records whether the integrator
  // callback has *succeeded*. This one answers "did any RPC accept the send?",
  // and only that question may steer the verdict below. Set before the callback
  // runs, so a hook that throws on every resend cannot make a real expiry look
  // like an outage.
  let sendAccepted = false
  const reportBroadcast = (): void => {
    sendAccepted = true
    if (broadcastReported) {
      return
    }
    try {
      options?.onBroadcast?.()
      // Latched only after the callback returned. A callback that threw wrote
      // nothing, so the next successful send must be allowed to try again -
      // latching first made one failed `txLink` write permanent.
      broadcastReported = true
    } catch (_) {
      // This runs integrator code: the callback reaches `updateRouteHook` via
      // `StatusManager.updateAction`. Its failure must never reject the branch
      // that called it - the send has already been accepted by the network at
      // this point, so a throw here would report a landed transaction as an
      // RPC outage. Swallowed rather than surfaced because there is no verdict
      // it could honestly change.
    }
  }

  const signedTxSerialized = getBase64EncodedWireTransaction(signedTransaction)
  const txSignature = getSignatureFromTransaction(signedTransaction)

  const lifetime = await getTransactionLifetime(signedTransaction)

  const rawTransactionOptions = {
    // We can skip preflight check after the first transaction has been sent
    // https://solana.com/docs/advanced/retry#the-cost-of-skipping-preflight
    skipPreflight: true,
    // Setting max retries to 0 as we are handling retries manually
    maxRetries: BigInt(0),
    // https://solana.com/docs/advanced/confirmation#use-an-appropriate-preflight-commitment-level
    preflightCommitment: 'confirmed' as Commitment,
    encoding: 'base64' as const,
  }

  const send = async (
    rpc: SolanaRpcType,
    signal: AbortSignal
  ): Promise<void> => {
    await rpc
      .sendTransaction(signedTxSerialized, rawTransactionOptions)
      .send({ abortSignal: signal })
  }

  const writeRpcs = options?.writeRpcUrls?.length
    ? getSolanaWriteRpcs(options.writeRpcUrls)
    : undefined

  // Sends to the write RPCs belong to the whole call, not to one branch:
  // other branches wait on the same send, so the branch that started it must
  // not cancel it by ending. They end when the race does.
  const writes = new AbortController()

  // Every confirmation branch resends about once a second. Branches share one
  // send to the write RPCs per interval, so each write RPC sees the same rate
  // it would as a configured RPC, however many configured RPCs are polling.
  let lastWrite: { at: number; sent: Promise<void> } | undefined
  const sendToWriteRpcs = (rpcs: SolanaRpcType[]): Promise<void> => {
    const now = Date.now()
    if (lastWrite && now - lastWrite.at < RESEND_INTERVAL_MS) {
      return lastWrite.sent
    }
    // Accepted as soon as one write RPC accepts it.
    const sent = Promise.any(rpcs.map((rpc) => send(rpc, writes.signal))).then(
      () => undefined
    )
    // Recorded here, not only by the branches: a branch stops waiting after
    // one interval (below), and an acceptance after that must still count.
    // Skipped once the race is over, so a late acceptance cannot regress an
    // action status the wait task already finalized.
    sent.then(
      () => {
        if (!writes.signal.aborted) {
          reportBroadcast()
        }
      },
      () => {}
    )
    lastWrite = { at: now, sent }
    return sent
  }

  // `confirmSignature` awaits its first send before it starts polling. Every
  // branch waits on the same shared send, so a write RPC that hangs would hold
  // up polling on all of them - even for a transaction that already landed.
  // A branch waits at most one resend interval, then polls either way.
  const waitForWrite = (sent: Promise<void>): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error('No write RPC accepted the transaction in time.')),
        RESEND_INTERVAL_MS
      )
      sent.then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        }
      )
    })

  const resend = writeRpcs
    ? (): Promise<void> => waitForWrite(sendToWriteRpcs(writeRpcs))
    : send

  let result: RaceResult<SignatureStatus>
  try {
    result = await raceRpcs(
      solanaRpcs,
      (rpc, signal) =>
        confirmSignature({
          rpc,
          signal,
          signature: txSignature,
          lifetimes: [lifetime],
          resend,
          onBroadcast: reportBroadcast,
        }),
      { timeoutMs: BRANCH_TIMEOUT_MS }
    )
  } finally {
    writes.abort()
  }

  // Only this scope knows whether ANY branch accepted the send. A branch that
  // polls to its deadline reports `not-confirmed` regardless - correct per
  // branch, but across the whole race it would claim a transaction expired
  // when nothing ever submitted it. That is an outage, not an expiry.
  //
  // Reads `sendAccepted`, never `broadcastReported`: the latter is false
  // whenever the integrator's callback threw, which says nothing about whether
  // the network took the transaction.
  if (result.kind === 'not-confirmed' && !sendAccepted) {
    return { kind: 'rpc-unavailable', errors: result.errors }
  }

  return result
}
