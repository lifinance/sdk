import { PrepareTransactionTask } from '@lifi/sdk'

/**
 * Always re-fetches the step transaction, where the base task asks only when
 * the step carries none.
 *
 * A Stellar envelope is not a reusable payload: the backend embeds the sender's
 * account sequence number and timebounds `[0, now + 300s]` at build time.
 *
 * 1. Approvals. `StellarSetAllowanceTask` submits a transaction of its own,
 *    which consumes the sender's sequence number. Any envelope built before
 *    that approval is invalid (`tx_bad_seq`), so the envelope has to be
 *    requested after it — which only happens if this task always asks for a
 *    fresh one.
 * 2. Staleness. On the quote path `convertQuoteToRoute` carries the quote's
 *    `transactionRequest` into the route, so the base guard would never
 *    re-fetch and would sign an envelope minted minutes earlier — expiring as
 *    `tx_too_late` once the user lingers in their wallet.
 *
 * The `getRoutes` path never carries a `transactionRequest`, and `resumeRoute`
 * clears it through `prepareRestart`, so the base guard already re-fetches for
 * both. This override is what covers the quote path.
 */
export class StellarPrepareTransactionTask extends PrepareTransactionTask {
  protected override shouldRefetchTransaction(): boolean {
    return true
  }
}
