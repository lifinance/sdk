import type { JitoRegion } from '../types.js'

/** Array of tip account addresses (Solana public keys) */
type GetTipAccountsResponse = string[]

export type GetTipAccountsApi = {
  /**
   * Fetches the tip accounts designated for tip payments for bundles.
   * Returns an array of 8 tip account addresses that can receive tips for transaction prioritization.
   * @see https://www.quicknode.com/docs/solana/getTipAccounts
   */
  getTipAccounts(
    /** The region to route the request to */
    region?: JitoRegion
  ): GetTipAccountsResponse
}
