import { ChainId, LiFiErrorCode, RPCError, type SDKClient } from '@lifi/sdk'
import { getBase64EncodedWireTransaction, type Transaction } from '@solana/kit'
import {
  type BundleConfirmation,
  confirmBundle,
} from '../confirmation/confirmBundle.js'
import { BRANCH_TIMEOUT_MS } from '../confirmation/createConfirmationDeadline.js'
import { type RaceResult, raceRpcs } from '../confirmation/raceRpcs.js'
import { getJitoRpcs, getJitoWriteRpcs } from '../rpc/registry.js'
import { getTransactionLifetime } from '../utils/getTransactionLifetime.js'

/**
 * Sends a Jito bundle to every Jito-capable RPC and returns as soon as one of
 * them confirms it.
 *
 * The deadline receives the lifetime of *every* signed transaction, not just
 * the first: a bundle is an array of independently built backend transactions
 * and they may not share a blockhash.
 *
 * `sendBundle` is handed to `confirmBundle` rather than awaited here, so the
 * deadline starts on the same clock as `BRANCH_TIMEOUT_MS` instead of after
 * the submission returns.
 *
 * When the client has Solana write RPCs (`rpcUrls[ChainId.SOL].write`), the
 * bundle is submitted once through those that pass the Jito probe, and the
 * read Jito RPCs only poll for it.
 */
export async function sendAndConfirmBundle(
  client: SDKClient,
  signedTransactions: Transaction[],
  options?: {
    /** Runs once, when the first Jito RPC accepts the submission. */
    onBroadcast?: () => void
  }
): Promise<RaceResult<BundleConfirmation>> {
  // Both probe on the latency path before submission, so run them together.
  // Only write RPCs that pass the probe submit; when none does, the read Jito
  // RPCs submit as they would without write RPCs.
  const [{ rpcs: jitoRpcs, unreachable }, writeRpcs] = await Promise.all([
    getJitoRpcs(client),
    Promise.resolve(client.getWriteRpcUrlsByChainId?.(ChainId.SOL)).then(
      (urls) => (urls?.length ? getJitoWriteRpcs(urls) : [])
    ),
  ])

  // Named here, where the emptiness is known: racing zero RPCs would surface
  // as a bare `rpc-unavailable`, indistinguishable from a total outage. The
  // two causes get different messages - a configuration gap the integrator can
  // close, or endpoints that never answered.
  //
  // The `unreachable` message names a plan gate as well as an outage: a bare
  // HTTP 401/403 never reaches the JSON-RPC layer, so `readProbeFailure`
  // cannot tell a gated endpoint from a provider mid-deploy and classifies
  // both as `unreachable`. "Retry" alone would loop an integrator forever on a
  // gate no retry can clear.
  if (jitoRpcs.length === 0) {
    throw new RPCError(
      LiFiErrorCode.RpcUnavailable,
      unreachable > 0
        ? `Jito bundle required, but the capability probe failed against ${unreachable} configured Solana RPC(s). This is usually temporary - retry. If it persists, the endpoint may refuse \`sendBundle\` for your plan.`
        : writeRpcs.length > 0
          ? 'Jito bundle required. A write RPC can submit it, but no read RPC supports `getBundleStatuses` to confirm it. Add a Jito-capable URL to `rpcUrls[ChainId.SOL].read`.'
          : 'Jito bundle required, but no configured Solana RPC supports `sendBundle`. Supply a Jito-capable URL via the `rpcUrls` client config option.'
    )
  }

  let broadcastReported = false
  // No `sendAccepted` twin here: a bundle submits once, and a failed `send()`
  // throws out of `confirmBundle` before polling starts, so this action has no
  // not-confirmed-but-never-sent case to disambiguate. See
  // `sendAndConfirmTransaction` for the signature path's version.
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

  const serializedTransactions = signedTransactions.map((transaction) =>
    getBase64EncodedWireTransaction(transaction)
  )

  const lifetimes = await Promise.all(
    signedTransactions.map((transaction) => getTransactionLifetime(transaction))
  )

  // One submission for every polling branch: the bundle id is derived from
  // the transactions, so each branch polls the same bundle. Started by the
  // first branch that asks, so its deadline already runs.
  let writeSubmission: Promise<string> | undefined
  const submitToWriteRpcs = (signal: AbortSignal): Promise<string> => {
    writeSubmission ??= Promise.any(
      writeRpcs.map((rpc) =>
        rpc.sendBundle(serializedTransactions).send({ abortSignal: signal })
      )
    ).catch((error: unknown) => {
      // Surface a refusal the way a single configured RPC would, not as a
      // nested AggregateError inside the race's own error list.
      throw error instanceof AggregateError ? error.errors[0] : error
    })
    return writeSubmission
  }

  return raceRpcs(
    jitoRpcs,
    (rpc, signal) =>
      confirmBundle({
        rpc,
        signal,
        lifetimes,
        send: () =>
          writeRpcs.length
            ? submitToWriteRpcs(signal)
            : rpc
                .sendBundle(serializedTransactions)
                .send({ abortSignal: signal }),
        onBroadcast: reportBroadcast,
      }),
    { timeoutMs: BRANCH_TIMEOUT_MS }
  )
}
