import type { Base64EncodedWireTransaction } from '@solana/kit'

import type { JitoRegion } from '../types.js'

/** Bundle ID returned on successful submission */
type SendBundleResponse = string

export type SendBundleApi = {
  /**
   * Submits a bundle of signed transactions (base-64 encoded) to the cluster for atomic processing.
   * If any transaction fails, the entire bundle is rejected.
   * This method relays the bundle to the leader without modifications.
   * If the bundle expires after the next Jito-Solana leader, it returns a success response with a bundle_id,
   * indicating receipt but not guaranteeing processing or on-chain landing.
   * Check the bundle status with getBundleStatuses using the bundle_id.
   *
   * Note: A tip is required for the bundle to be considered. The tip must transfer SOL to one of the 8 tip accounts.
   * @see https://www.quicknode.com/docs/solana/sendBundle
   */
  sendBundle(
    /** Array of base64-encoded signed transactions */
    transactions: Array<Base64EncodedWireTransaction>,
    /** The region to route the request to */
    region?: JitoRegion
  ): SendBundleResponse
}
