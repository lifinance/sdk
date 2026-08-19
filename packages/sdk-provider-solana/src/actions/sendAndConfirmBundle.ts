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
  const jitoRpcs = await getJitoRpcs(client)

  // An empty list is a configuration gap, not an outage, and the two must
  // not share an error: this step's `transactionRequest.data` is a Jito
  // bundle, `getJitoRpcs` filters the configured Solana RPC URLs through a
  // `getBundleStatuses` probe, and the default LI.FI RPC set contains no
  // endpoint that answers it. Racing zero RPCs would surface as a bare
  // `rpc-unavailable` with no errors - indistinguishable from every endpoint
  // being down - so the gap is named here, where the emptiness is known.
  if (jitoRpcs.length === 0) {
    throw new RPCError(
      LiFiErrorCode.RpcUnavailable,
      'This step must be submitted as a Jito bundle, but no configured Solana RPC supports Jito bundle methods (`sendBundle`/`getBundleStatuses`) - the default LI.FI RPCs do not. Configure a Jito-capable Solana RPC URL via the `rpcUrls` client config option to execute this route.'
    )
  }

  let broadcastReported = false
  const reportBroadcast = (): void => {
    if (!broadcastReported) {
      broadcastReported = true
      options?.onBroadcast?.()
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
