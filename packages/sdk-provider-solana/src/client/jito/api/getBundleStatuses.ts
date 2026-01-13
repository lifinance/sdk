import type { Signature } from '@solana/kit'

import type { JitoRegion } from '../types.js'

type BundleStatus = {
  bundle_id: string
  transactions: Signature[]
  slot: number
  confirmation_status: 'processed' | 'confirmed' | 'finalized' | null
  err: unknown
}

type GetBundleStatusesResponse = {
  context: {
    slot: number
  }
  value: BundleStatus[]
}

export type GetBundleStatusesApi = {
  /**
   * Returns the status of submitted bundle(s).
   * @see https://www.quicknode.com/docs/solana/getBundleStatuses
   */
  getBundleStatuses(
    /** Array of bundle IDs to get status for */
    bundleIds: string[],
    /** The region to route the request to */
    region?: JitoRegion
  ): GetBundleStatusesResponse
}
