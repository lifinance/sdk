import type { Blockhash } from '@solana/kit'
import type { SolanaRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'

/** Absolute give-up point. Nothing can extend it. */
export const CONFIRMATION_TIMEOUT_MS = 90_000
/** Nothing may report expiry before this, whatever an RPC claims. */
export const MIN_CONFIRMATION_MS = 5_000
/** Consecutive `false` results required before we believe a blockhash is dead. */
export const EXPIRY_CONFIRMATIONS = 3
/** Consecutive probe failures after which we stop probing entirely. */
export const MAX_PROBE_ERRORS = 5

/**
 * Structural, so one implementation serves both the Solana and the Jito RPC —
 * `JitoRpcApi` includes `SolanaRpcApi`.
 */
export type BlockhashProbeRpc = Pick<SolanaRpcType, 'isBlockhashValid'>

export interface ConfirmationDeadline {
  /** Checked at the top of every poll iteration. */
  reached(): boolean
  /** Advances the policy once per poll iteration. Never throws. */
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
  let errorStreak = 0
  let probing = blockhashes.length > 0
  let expired = false

  return {
    reached(): boolean {
      const elapsed = now() - startedAt
      if (elapsed >= CONFIRMATION_TIMEOUT_MS) {
        return true
      }
      if (elapsed < MIN_CONFIRMATION_MS) {
        return false
      }
      return expired
    },
    async tick(signal: AbortSignal): Promise<void> {
      if (!probing || expired || signal.aborted) {
        return
      }
      try {
        const probes = await Promise.all(
          blockhashes.map(async (blockhash) => {
            const result = await rpc
              .isBlockhashValid(blockhash, { commitment: 'confirmed' })
              .send({ abortSignal: signal })
            return { blockhash, valid: result.value }
          })
        )
        errorStreak = 0
        // `isBlockhashValid` returns false both for a dead blockhash and for a
        // node that has not seen it yet, so one false is not enough. Each
        // blockhash keeps its own streak, so failures alternating between two
        // blockhashes never add up to an expiry neither of them reached.
        for (const { blockhash, valid } of probes) {
          const streak = valid ? 0 : (expiredStreaks.get(blockhash) ?? 0) + 1
          expiredStreaks.set(blockhash, streak)
          if (streak >= EXPIRY_CONFIRMATIONS) {
            expired = true
          }
        }
      } catch (_) {
        errorStreak += 1
        expiredStreaks.clear()
        if (errorStreak >= MAX_PROBE_ERRORS) {
          // Degrade to ceiling-only. A probe failure must never be read as
          // expiry, and it must never spin forever either.
          probing = false
        }
      }
    },
  }
}
