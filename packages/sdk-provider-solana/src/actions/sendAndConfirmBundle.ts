import { ChainId, LiFiErrorCode, RPCError, type SDKClient } from '@lifi/sdk'
import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Transaction,
} from '@solana/kit'
import {
  type BundleConfirmation,
  confirmBundle,
} from '../confirmation/confirmBundle.js'
import { BRANCH_TIMEOUT_MS } from '../confirmation/createConfirmationDeadline.js'
import { type RaceResult, raceRpcs } from '../confirmation/raceRpcs.js'
import {
  getJitoCapableRpcs,
  getJitoRpcs,
  getSolanaRpcs,
} from '../rpc/registry.js'
import type { JitoRpcType } from '../rpc/types.js'
import { getTransactionLifetime } from '../utils/getTransactionLifetime.js'

/**
 * Sends a Jito bundle once and returns as soon as one read RPC sees every
 * transaction of it confirmed.
 *
 * The deadline receives the lifetime of *every* signed transaction, not just
 * the first: a bundle is an array of independently built backend transactions
 * and they may not share a blockhash.
 *
 * `sendBundle` is handed to `confirmBundle` rather than awaited here, so the
 * deadline starts on the same clock as `BRANCH_TIMEOUT_MS` instead of after
 * the submission returns.
 *
 * The bundle is submitted once through the RPCs that pass the Jito probe: the
 * bundle list of `rpcUrls[ChainId.SOL]` first, else the write list, else the
 * read RPCs. With either list set, bundles never go to the read RPCs. Every
 * read RPC confirms the bundle by its transaction signatures, so no read RPC
 * needs Jito support and the `sendBundle` answer is not read.
 */
export async function sendAndConfirmBundle(
  client: SDKClient,
  signedTransactions: Transaction[],
  options?: {
    /** Runs once, when the first submit RPC accepts the submission. */
    onBroadcast?: () => void
  }
): Promise<RaceResult<BundleConfirmation>> {
  // With a bundle or write list set, bundles go only to those: the bundle
  // RPCs that pass the Jito probe, else the write RPCs that do. The write list
  // is probed only when it is needed. With neither list, the read RPCs that
  // pass the Jito probe submit.
  const [bundleUrls = [], writeUrls = []] = await Promise.all([
    client.getBundleRpcUrlsByChainId?.(ChainId.SOL),
    client.getWriteRpcUrlsByChainId?.(ChainId.SOL),
  ])
  const noSubmitRpcs = { rpcs: [] as JitoRpcType[], unreachable: 0 }
  const findSubmitRpcs = async (): Promise<typeof noSubmitRpcs> => {
    const bundle = bundleUrls.length
      ? await getJitoCapableRpcs(bundleUrls)
      : noSubmitRpcs
    if (bundle.rpcs.length || !writeUrls.length) {
      return bundle
    }
    const write = await getJitoCapableRpcs(writeUrls)
    return {
      rpcs: write.rpcs,
      unreachable: bundle.unreachable + write.unreachable,
    }
  }
  const hasSubmitLists = bundleUrls.length > 0 || writeUrls.length > 0
  const [{ rpcs: submitRpcs, unreachable }, confirmRpcs] = await Promise.all([
    hasSubmitLists ? findSubmitRpcs() : getJitoRpcs(client),
    getSolanaRpcs(client),
  ])

  if (hasSubmitLists && !submitRpcs.length) {
    // Names only the lists that are set.
    const lists = Object.entries({ bundle: bundleUrls, write: writeUrls })
      .filter(([, urls]) => urls.length > 0)
      .map(([name]) => `\`rpcUrls[ChainId.SOL].${name}\``)
      .join(' or ')
    throw new RPCError(
      LiFiErrorCode.RpcUnavailable,
      [
        `Jito bundle required, but no URL in ${lists} passed the Jito capability probe.`,
        unreachable > 0
          ? 'The probe got no answer from some of them. This is usually temporary - retry. If it persists, the endpoint may refuse `sendBundle` for your plan.'
          : 'They do not support `sendBundle`: add a Jito-capable URL to `rpcUrls[ChainId.SOL].bundle`.',
        'Bundles never go to the read RPCs while `bundle` or `write` is set.',
      ].join(' ')
    )
  }

  // Named here, where the emptiness is known: submitting to zero RPCs would
  // surface as a bare `rpc-unavailable`, indistinguishable from an outage. The
  // two causes get different messages - a configuration gap the integrator can
  // close, or endpoints that never answered.
  //
  // The `unreachable` message names a plan gate as well as an outage: a bare
  // HTTP 401/403 never reaches the JSON-RPC layer, so `readProbeFailure`
  // cannot tell a gated endpoint from a provider mid-deploy and classifies
  // both as `unreachable`. "Retry" alone would loop an integrator forever on a
  // gate no retry can clear.
  if (!submitRpcs.length) {
    throw new RPCError(
      LiFiErrorCode.RpcUnavailable,
      unreachable > 0
        ? `Jito bundle required, but the capability probe failed against ${unreachable} configured Solana RPC(s). This is usually temporary - retry. If it persists, the endpoint may refuse \`sendBundle\` for your plan.`
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

  const signatures = signedTransactions.map((transaction) =>
    getSignatureFromTransaction(transaction)
  )
  const serializedTransactions = signedTransactions.map((transaction) =>
    getBase64EncodedWireTransaction(transaction)
  )

  const lifetimes = await Promise.all(
    signedTransactions.map((transaction) => getTransactionLifetime(transaction))
  )

  // One submission for every confirming branch. Its answer is not read: the
  // branches read the signatures, and senders answer `sendBundle` in different
  // shapes. Started by the first branch that asks, so its deadline already
  // runs.
  let submission: Promise<unknown> | undefined
  const submitOnce = (signal: AbortSignal): Promise<unknown> => {
    submission ??= Promise.any(
      submitRpcs.map((rpc) =>
        rpc.sendBundle(serializedTransactions).send({ abortSignal: signal })
      )
    ).catch((error: unknown) => {
      // Surface a refusal the way a single configured RPC would, not as a
      // nested AggregateError inside the race's own error list.
      throw error instanceof AggregateError ? error.errors[0] : error
    })
    return submission
  }

  return raceRpcs(
    confirmRpcs,
    (rpc, signal) =>
      confirmBundle({
        rpc,
        signal,
        signatures,
        lifetimes,
        send: () => submitOnce(signal),
        onBroadcast: reportBroadcast,
      }),
    { timeoutMs: BRANCH_TIMEOUT_MS }
  )
}
