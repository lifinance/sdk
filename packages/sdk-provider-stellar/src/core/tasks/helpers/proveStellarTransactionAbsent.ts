import type { SDKClient } from '@lifi/sdk'
import { Api, type Server } from '@stellar/stellar-sdk/rpc'
import { getStellarRpcs } from '../../../client/getStellarRpc.js'

/**
 * A node's latest ledger must have closed this long after the envelope's
 * `maxTime` before its NOT_FOUND counts. Close times only grow, so every ledger
 * that could still include the envelope is then in that node's history. Five
 * or six ledgers of slack.
 */
const HEAD_MARGIN_SECONDS = 30

/** When the transaction could have been applied, in unix seconds (chain time). */
export interface StellarLandingWindow {
  /** Earliest time the transaction could have been applied (the anchor). */
  earliest: number
  /** The envelope's `maxTime`: no ledger that closes later can include it. */
  maxTime: number
}

/**
 * True only when the chain proves that the transaction was never applied.
 *
 * Every configured RPC is asked once. A NOT_FOUND counts only when the same
 * response proves that its node would know the transaction: the node's history
 * starts before `window.earliest` (`oldestLedgerCloseTime`), and its latest
 * ledger closed after `window.maxTime` plus a margin (`latestLedgerCloseTime`).
 * A separate `getHealth` or `getLatestLedger` request would prove nothing,
 * because a URL can be a load-balanced pool of different backends.
 *
 * A node that returns the transaction (SUCCESS or FAILED) makes the answer
 * false. A failed request, and a NOT_FOUND that does not prove coverage, give
 * no information.
 */
export const proveStellarTransactionAbsent = async (
  client: SDKClient,
  transactionHash: string,
  window: StellarLandingWindow
): Promise<boolean> => {
  let servers: Server[]
  try {
    servers = await getStellarRpcs(client)
  } catch {
    return false
  }

  const results = await Promise.allSettled(
    servers.map((server) => server.getTransaction(transactionHash))
  )

  let provenAbsent = false
  for (const result of results) {
    if (result.status === 'rejected') {
      continue
    }
    const response = result.value
    if (response.status !== Api.GetTransactionStatus.NOT_FOUND) {
      return false
    }
    // Unix seconds. The SDK types say number, but the SDK passes the raw JSON
    // value through, so `Number` also accepts a string. `Number(null)` and
    // `Number('')` are 0, which is before every anchor, so only a positive
    // close time counts as the start of the node's history.
    const oldest = Number(response.oldestLedgerCloseTime)
    const latest = Number(response.latestLedgerCloseTime)
    if (
      Number.isFinite(oldest) &&
      Number.isFinite(latest) &&
      oldest > 0 &&
      oldest < window.earliest &&
      latest > window.maxTime + HEAD_MARGIN_SECONDS
    ) {
      provenAbsent = true
    }
  }
  return provenAbsent
}
