import { BASE_FEE } from '@stellar/stellar-sdk'
import type { Server } from '@stellar/stellar-sdk/rpc'

/** stroops/op — the network minimum, and the floor under any bid. */
const MIN_BASE_FEE = Number(BASE_FEE)

/** stroops/op — the bid placed when fee stats cannot be read or decoded. */
const FALLBACK_FEE = 10_000

/**
 * stroops/op cap (0.1 XLM). A broken RPC percentile must never reach a real
 * bid, so the ceiling is enforced even on a value the network reported.
 */
const MAX_FEE_STROOPS = 1_000_000

/**
 * Percentile read for the inclusion bid.
 *
 * `p70` deliberately matches the percentile the backend bids when it builds the
 * route transaction, so the approval and the route it unblocks compete for
 * inclusion on equal terms. A cheaper approval is not a cheaper route — it is a
 * route that never starts.
 */
const INCLUSION_FEE_PERCENTILE = 'p70' as const

const clampBid = (value: number): number =>
  Math.min(MAX_FEE_STROOPS, Math.max(MIN_BASE_FEE, value))

/**
 * Resolves the per-operation inclusion fee to bid for a Soroban transaction.
 *
 * `BASE_FEE` is the network *minimum*, not a market price: Soroban validators
 * rank transactions by the inclusion component alone, and when the Soroban
 * ledger is at capacity every included transaction pays well above the minimum.
 * A minimum bid is then accepted into the mempool, never wins a slot, and dies
 * silently when its timebound expires — `sendTransaction` reports `PENDING` and
 * `getTransaction` reports `NOT_FOUND` forever, with nothing on chain to
 * explain it. Reading the live distribution is what avoids that.
 *
 * Note the resource fee cannot substitute for this. `prepareTransaction` folds
 * a large resource fee into the total, but that buys nothing in the inclusion
 * queue.
 *
 * Fee stats are read best-effort: the surrounding RPC failover has already
 * proven this server answers, so a `getFeeStats` hiccup falls back to a bid
 * rather than failing the approval.
 */
export const resolveSorobanInclusionFee = async (
  server: Server
): Promise<string> => {
  try {
    const feeStats = await server.getFeeStats()
    const percentile = Number(
      feeStats?.sorobanInclusionFee?.[INCLUSION_FEE_PERCENTILE]
    )
    return String(
      clampBid(
        Number.isFinite(percentile) && percentile > 0
          ? percentile
          : FALLBACK_FEE
      )
    )
  } catch {
    return String(clampBid(FALLBACK_FEE))
  }
}
