import type { Blockhash } from '@solana/kit'
import type { SolanaRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'

/** Give-up point for a branch's polling. Read between iterations only, so a
 * hung RPC call needs `BRANCH_TIMEOUT_MS` to close the gap. */
export const CONFIRMATION_TIMEOUT_MS = 90_000
/** Head-room for the final probe after the deadline.
 * `STATUS_RETRY_BACKOFF_CAP_MS` must stay below it. */
export const FINAL_PROBE_MARGIN_MS = 5_000
/** Hard bound on a branch, in-flight requests included. Above the ceiling so
 * an abort cannot pre-empt the final probe. */
export const BRANCH_TIMEOUT_MS: number =
  CONFIRMATION_TIMEOUT_MS + FINAL_PROBE_MARGIN_MS
/** How long a healthy-but-lagging node may need to catch up. A premise, not a
 * knob: `isBlockhashValid` answers `false` for lag and for death alike, so no
 * verdict may land inside this window. */
export const NODE_LAG_WINDOW_MS = 12_000
/** Gap between `isBlockhashValid` probes. Spacing them is what makes the
 * consecutive-`false` rule meaningful: quantized to the 400 ms tick, probes
 * land at 0.4/7.6/14.8 s, so no verdict lands inside `NODE_LAG_WINDOW_MS`. */
export const EXPIRY_PROBE_INTERVAL_MS = 7_000
/** Consecutive `false` results before a blockhash is believed dead. Derived so
 * a change to either premise moves it automatically; `+ 2` keeps the
 * inequality strict when the window divides exactly. */
export const EXPIRY_CONFIRMATIONS: number =
  Math.floor(NODE_LAG_WINDOW_MS / EXPIRY_PROBE_INTERVAL_MS) + 2
/** Probe failures per blockhash before that blockhash stops being probed.
 * Prober-only; the status pollers have `MAX_STATUS_READ_SILENCE_MS`. */
export const MAX_PROBE_ERRORS = 5

/** Structural, so one implementation serves both the Solana and Jito RPC. */
export type BlockhashProbeRpc = Pick<SolanaRpcType, 'isBlockhashValid'>

export interface ConfirmationDeadline {
  /** Checked at the top of every poll iteration. */
  reached(): boolean
  /** Advances the policy; never throws. Probes at most once per
   * `EXPIRY_PROBE_INTERVAL_MS`. */
  tick(signal: AbortSignal): Promise<void>
}

/**
 * Owns every "should I stop polling?" decision.
 *
 * Never reads `getBlockHeight`: at least one default LI.FI RPC answers it with
 * the slot number, making any `lastValidBlockHeight` comparison false on its
 * first evaluation.
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

  /** Derived, not latched: a blockhash that reads valid again zeroes its
   * streak and clears the verdict with it. */
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
      // `allSettled`, not `all`: `all` rejects on the first failure and
      // discards answers the other probes already produced. All state is keyed
      // by blockhash, so one broken probe cannot disable the early exit for
      // the rest.
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
          // A failed read is not a `false`; it says nothing about this
          // blockhash.
          expiredStreaks.set(blockhash, 0)
          const errors = (errorStreaks.get(blockhash) ?? 0) + 1
          errorStreaks.set(blockhash, errors)
          if (errors >= MAX_PROBE_ERRORS) {
            // Degrade to ceiling-only for this blockhash.
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
