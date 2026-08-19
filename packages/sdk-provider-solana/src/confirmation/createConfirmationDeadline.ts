import type { Blockhash } from '@solana/kit'
import type { SolanaRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'

/**
 * Give-up point for a branch's own polling, measured from the moment that
 * branch builds its deadline. Nothing in this module extends it.
 *
 * It is not by itself an absolute bound on a branch: `reached()` is only read
 * between iterations, so a branch suspended inside an RPC call that never
 * answers never gets to read it. `BRANCH_TIMEOUT_MS` is what closes that gap.
 */
export const CONFIRMATION_TIMEOUT_MS = 90_000
/**
 * Hard bound on a single RPC branch, in-flight requests included. Handed to
 * `raceRpcs` by the actions, which abort every branch's request with it.
 *
 * Deliberately above `CONFIRMATION_TIMEOUT_MS`: a branch that stops on its own
 * deadline still runs one final status probe, and an abort fired at the same
 * instant would pre-empt it. The gap is a backstop, not a second policy —
 * nothing reaches it unless an endpoint has stopped answering entirely.
 * `STATUS_RETRY_BACKOFF_CAP_MS` must stay below this gap: the last backoff
 * sleep before the ceiling is the only thing that can eat into it.
 */
export const BRANCH_TIMEOUT_MS: number = CONFIRMATION_TIMEOUT_MS + 5_000
/** Consecutive `false` results required before we believe a blockhash is dead. */
export const EXPIRY_CONFIRMATIONS = 3
/**
 * Minimum wall-clock gap between two `isBlockhashValid` probes of the same
 * deadline.
 *
 * This is the real guard against a false expiry. `isBlockhashValid` returns
 * `false` both for a dead blockhash and for a node that has not yet seen it,
 * so the consecutive-`false` rule only means anything if the probes are far
 * enough apart that a node lagging the cluster cannot answer `false` three
 * times in a row. At the deadline-advance cadence that would be ~1.2 s —
 * about three slots, which a lagging node clears routinely.
 * `EXPIRY_CONFIRMATIONS` probes at this interval instead span 14 s (~35
 * slots) before any verdict: the first probe fires on the first tick
 * (~0.4 s in), so the earliest possible expiry verdict sits at ~14.4 s, and a
 * node must lag the tip for that entire window to produce one. The previous
 * 3 s interval allowed a verdict at ~6.4 s, inside a plausible lag window.
 *
 * It also caps the probe cost: ~13 `isBlockhashValid` calls per distinct
 * blockhash per RPC across the whole ceiling instead of one per tick.
 *
 * No runtime floor backs this up: the cadence is the only thing keeping the
 * earliest verdict outside a node-lag window. The unit spec pins that
 * arithmetic, so speeding this cadence up fails the spec before it can fail
 * in production.
 */
export const EXPIRY_PROBE_INTERVAL_MS = 7_000
/**
 * Consecutive failures of one blockhash's own probe after which that
 * blockhash stops being probed. The budget is per blockhash: a sibling whose
 * endpoint never answers must not end the early exit for a blockhash whose
 * own probes all succeed.
 *
 * This constant belongs to the blockhash prober alone — do not reuse it for
 * the status pollers. It counts failures at the probe cadence
 * (`EXPIRY_PROBE_INTERVAL_MS`, so five failures span ~28 s), and its
 * consequence is soft: that blockhash stops being probed and the deadline
 * degrades toward the wall-clock ceiling, while status polling continues
 * untouched. The status
 * pollers count failures at a far faster cadence and their consequence is a
 * throw; they have their own budget, `MAX_STATUS_READ_FAILURES` in
 * `pollUntilDeadline.ts`.
 */
export const MAX_PROBE_ERRORS = 5

/**
 * Structural, so one implementation serves both the Solana and the Jito RPC —
 * `JitoRpcApi` includes `SolanaRpcApi`.
 */
export type BlockhashProbeRpc = Pick<SolanaRpcType, 'isBlockhashValid'>

export interface ConfirmationDeadline {
  /** Checked at the top of every poll iteration. */
  reached(): boolean
  /**
   * Advances the policy. Never throws.
   *
   * Called on the deadline-advance cadence (`DEADLINE_TICK_INTERVAL_MS` in
   * `pollUntilDeadline.ts`), but only probes when `EXPIRY_PROBE_INTERVAL_MS`
   * has passed since the last probe.
   */
  tick(signal: AbortSignal): Promise<void>
}

/**
 * Owns every "should I stop polling?" decision.
 *
 * The deadline deliberately never reads `getBlockHeight`: at least one RPC in
 * the default LI.FI set answers it with the slot number, which is ~22 million
 * higher than the block height and makes any comparison against
 * `lastValidBlockHeight` false on its first evaluation.
 */
export function createConfirmationDeadline(options: {
  lifetimes: TransactionLifetime[]
  rpc: BlockhashProbeRpc
  now?: () => number
}): ConfirmationDeadline {
  const { lifetimes, rpc } = options
  const now = options.now ?? Date.now
  const startedAt = now()

  const blockhashLifetimes = lifetimes.filter(
    (
      lifetime
    ): lifetime is Extract<TransactionLifetime, { kind: 'blockhash' }> =>
      lifetime.kind === 'blockhash'
  )
  // A single non-blockhash lifetime disables the early exit for the whole set:
  // we cannot know when such a transaction stops being landable.
  const allProbeable =
    lifetimes.length > 0 && blockhashLifetimes.length === lifetimes.length
  const blockhashes: Blockhash[] = allProbeable
    ? [...new Set(blockhashLifetimes.map((lifetime) => lifetime.blockhash))]
    : []

  // Keyed by blockhash: expiry is a property of a blockhash, not of the set.
  const expiredStreaks = new Map<Blockhash, number>()
  // Keyed for the same reason: a sibling's broken probe is not evidence about
  // this blockhash, so it must not spend this blockhash's error budget.
  const errorStreaks = new Map<Blockhash, number>()
  // The blockhashes still worth asking about. One leaves this set after
  // MAX_PROBE_ERRORS failures of its own; the others keep being probed.
  const probeable = new Set<Blockhash>(blockhashes)
  let lastProbeAt: number | undefined

  /**
   * Derived from the live streaks rather than latched. A blockhash that reads
   * valid again zeroes its streak, and the verdict goes with it: a node that
   * lagged long enough to answer `false` three times must not condemn a
   * blockhash it then reports as alive.
   */
  const isExpired = (): boolean => {
    for (const streak of expiredStreaks.values()) {
      if (streak >= EXPIRY_CONFIRMATIONS) {
        return true
      }
    }
    return false
  }

  return {
    reached(): boolean {
      const elapsed = now() - startedAt
      if (elapsed >= CONFIRMATION_TIMEOUT_MS) {
        return true
      }
      return isExpired()
    },
    async tick(signal: AbortSignal): Promise<void> {
      if (probeable.size === 0 || signal.aborted) {
        return
      }
      // The cadence is wall-clock, not iteration count, and it uses the
      // injected `now` so the policy stays testable without timers.
      const probeAt = now()
      if (
        lastProbeAt !== undefined &&
        probeAt - lastProbeAt < EXPIRY_PROBE_INTERVAL_MS
      ) {
        return
      }
      lastProbeAt = probeAt
      // `allSettled`, not `all`: a round probes one blockhash per lifetime,
      // and `all` rejects on the first failure - discarding the answers the
      // other probes already produced. Every piece of state this round writes
      // is keyed by blockhash, so a failing probe can neither reset another
      // blockhash's expiry streak nor spend another blockhash's error budget.
      // While they were shared, a single permanently broken probe disabled the
      // early exit for the whole set - exactly where several lifetimes race
      // expiry and the early exit matters most.
      const active = [...probeable]
      const probes = await Promise.allSettled(
        active.map(async (blockhash) => {
          const result = await rpc
            .isBlockhashValid(blockhash, { commitment: 'confirmed' })
            .send({ abortSignal: signal })
          return result.value
        })
      )

      probes.forEach((probe, index) => {
        const blockhash = active[index]

        if (probe.status === 'rejected') {
          // A failed read says nothing about this blockhash, so it must not
          // stand in for the `false` that would have continued a streak.
          expiredStreaks.set(blockhash, 0)
          const errors = (errorStreaks.get(blockhash) ?? 0) + 1
          errorStreaks.set(blockhash, errors)
          if (errors >= MAX_PROBE_ERRORS) {
            // This blockhash degrades to ceiling-only. A probe failure must
            // never be read as expiry, and it must never spin forever either.
            probeable.delete(blockhash)
          }
          return
        }

        errorStreaks.set(blockhash, 0)
        const streak = probe.value
          ? 0
          : (expiredStreaks.get(blockhash) ?? 0) + 1
        expiredStreaks.set(blockhash, streak)
      })
    },
  }
}
