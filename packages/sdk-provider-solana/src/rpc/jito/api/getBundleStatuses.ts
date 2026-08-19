import type { Signature } from '@solana/kit'

import type { JitoRegion } from '../types.js'

type BundleStatus = {
  bundle_id: string
  /**
   * Optional because this is unvalidated wire data, not a guarantee. Jito
   * documents the field, but nothing here parses the response, so a status
   * that arrives without it must be a case the reader handles rather than a
   * `TypeError` in the middle of a confirmation.
   */
  transactions?: Signature[]
  slot: number
  confirmation_status: 'processed' | 'confirmed' | 'finalized' | null
  err: unknown
}

type GetBundleStatusesResponse = {
  context: {
    slot: number
  }
  /** Jito answers with `null` for a bundle id it does not know. */
  value: (BundleStatus | null)[]
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
