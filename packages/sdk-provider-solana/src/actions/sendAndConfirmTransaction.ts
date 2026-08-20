import type { SDKClient } from '@lifi/sdk'
import {
  type Commitment,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Transaction,
} from '@solana/kit'
import { confirmSignature } from '../confirmation/confirmSignature.js'
import { BRANCH_TIMEOUT_MS } from '../confirmation/createConfirmationDeadline.js'
import { type RaceResult, raceRpcs } from '../confirmation/raceRpcs.js'
import type { SignatureStatus } from '../confirmation/types.js'
import { getSolanaRpcs } from '../rpc/registry.js'
import type { SolanaRpcType } from '../rpc/types.js'
import { getTransactionLifetime } from '../utils/getTransactionLifetime.js'

/**
 * Sends a Solana transaction to every configured RPC and returns as soon as
 * one of them confirms it.
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
  }
): Promise<RaceResult<SignatureStatus>> {
  const solanaRpcs = await getSolanaRpcs(client)

  let broadcastReported = false
  const reportBroadcast = (): void => {
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

  const resend = async (
    rpc: SolanaRpcType,
    signal: AbortSignal
  ): Promise<void> => {
    await rpc
      .sendTransaction(signedTxSerialized, rawTransactionOptions)
      .send({ abortSignal: signal })
  }

  const result = await raceRpcs(
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

  // Only this scope knows whether ANY branch accepted the send. A branch that
  // polls to its deadline reports `not-confirmed` regardless - correct per
  // branch, but across the whole race it would claim a transaction expired
  // when nothing ever submitted it. That is an outage, not an expiry.
  if (result.kind === 'not-confirmed' && !broadcastReported) {
    return { kind: 'rpc-unavailable', errors: result.errors }
  }

  return result
}
