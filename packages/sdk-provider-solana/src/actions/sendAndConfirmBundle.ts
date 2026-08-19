import { LiFiErrorCode, RPCError, type SDKClient } from '@lifi/sdk'
import { getBase64EncodedWireTransaction, type Transaction } from '@solana/kit'
import {
  type BundleConfirmation,
  confirmBundle,
} from '../confirmation/confirmBundle.js'
import { BRANCH_TIMEOUT_MS } from '../confirmation/createConfirmationDeadline.js'
import { type RaceResult, raceRpcs } from '../confirmation/raceRpcs.js'
import { getJitoRpcs } from '../rpc/registry.js'
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
 */
export async function sendAndConfirmBundle(
  client: SDKClient,
  signedTransactions: Transaction[],
  options?: {
    /**
     * Runs once, when the first Jito RPC accepts the bundle submission. From
     * that moment the bundle is genuinely in the network's hands, so this is
     * the earliest honest point to show a user an explorer link. The
     * once-guard lives here so the caller sees a single event however many
     * branches submit successfully.
     */
    onBroadcast?: () => void
  }
): Promise<RaceResult<BundleConfirmation>> {
  const { rpcs: jitoRpcs, unreachable } = await getJitoRpcs(client)

  // An empty list is named here, where the emptiness is known: racing zero
  // RPCs would surface as a bare `rpc-unavailable` with no errors, which is
  // indistinguishable from every endpoint being down.
  //
  // The two reasons it can be empty do not share a message. Every configured
  // endpoint answering "method not found" is a configuration gap the
  // integrator can close; endpoints that never answered are an outage, and
  // telling someone to configure an `rpcUrls` entry they already configured
  // sends them after the wrong problem. `unreachable` counts the second kind.
  if (jitoRpcs.length === 0) {
    throw new RPCError(
      LiFiErrorCode.RpcUnavailable,
      unreachable > 0
        ? `This step must be submitted as a Jito bundle, but the Jito capability probe (\`getBundleStatuses\`) failed against ${unreachable} configured Solana RPC ${unreachable === 1 ? 'endpoint' : 'endpoints'} without reporting the method as unknown. Those endpoints may be temporarily unavailable - retry before changing configuration.`
        : 'This step must be submitted as a Jito bundle, but no configured Solana RPC supports Jito bundle methods (`sendBundle`/`getBundleStatuses`) - the default LI.FI RPCs do not. Configure a Jito-capable Solana RPC URL via the `rpcUrls` client config option to execute this route.'
    )
  }

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

  const serializedTransactions = signedTransactions.map((transaction) =>
    getBase64EncodedWireTransaction(transaction)
  )

  const lifetimes = await Promise.all(
    signedTransactions.map((transaction) => getTransactionLifetime(transaction))
  )

  return raceRpcs(
    jitoRpcs,
    (rpc, signal) =>
      confirmBundle({
        rpc,
        signal,
        lifetimes,
        send: () =>
          rpc.sendBundle(serializedTransactions).send({ abortSignal: signal }),
        onBroadcast: reportBroadcast,
      }),
    { timeoutMs: BRANCH_TIMEOUT_MS }
  )
}
