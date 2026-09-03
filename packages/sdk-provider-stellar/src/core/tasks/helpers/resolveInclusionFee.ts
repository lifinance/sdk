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
 * `p70` matches the backend's `standard` fee tier — `getFeeTiers` in
 * lifi-backend `apps/backend-api/src/stellar/gas/stellar.gas.ts` maps
 * slow/standard/fast to p20/p70/p95, and the three constants above mirror that
 * module. Bidding the same percentile keeps the approval and the route it
 * unblocks on equal terms: a cheaper approval is not a cheaper route — it is a
 * route that never starts.
 *
 * Known limitation. `getFeeStats` reports the inclusion fees transactions were
 * *charged*, not the fees they bid. Under surge pricing every transaction in an
 * included set pays the lowest bid in that set, so the reported values cluster
 * at recent clearing prices rather than spanning a range of bids — a 2026-09
 * mainnet sample over ~7k transactions returned `p10` through `p99` all equal.
 * A mid percentile of clearing prices is therefore a marginal bid. Raising it
 * is worth doing, but only alongside the backend so the two stay aligned.
 */
const INCLUSION_FEE_PERCENTILE = 'p70' as const

/** Bounds a bid to an integer in range — the builder rejects non-integers. */
const clampBid = (value: number): number =>
  Math.floor(Math.min(MAX_FEE_STROOPS, Math.max(MIN_BASE_FEE, value)))

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
 * rather than failing the approval. Both degraded paths warn, because a silent
 * fallback re-creates the undiagnosable failure this helper exists to remove.
 */
export const resolveSorobanInclusionFee = async (
  server: Server
): Promise<string> => {
  try {
    const feeStats = await server.getFeeStats()
    const reported = feeStats?.sorobanInclusionFee?.[INCLUSION_FEE_PERCENTILE]
    const percentile = Number(reported)
    if (!Number.isFinite(percentile) || percentile <= 0) {
      console.warn(
        '[resolveSorobanInclusionFee] Unusable fee percentile, using fallback bid:',
        FALLBACK_FEE,
        reported
      )
      return String(FALLBACK_FEE)
    }
    return String(clampBid(percentile))
  } catch (error) {
    console.warn(
      '[resolveSorobanInclusionFee] Fee stats unreadable, using fallback bid:',
      FALLBACK_FEE,
      error
    )
    return String(FALLBACK_FEE)
  }
}
