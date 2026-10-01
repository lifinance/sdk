/**
 * Result of the Task 0 check: true only if re-executing an already executed
 * transaction returns its effects instead of a rejection. Only then does a
 * definite rejection of the re-execution prove that the digest never executed
 * (its inputs are spent by other transactions), so the rejection is final.
 * While false, such a rejection stays an unknown outcome.
 */
export const SUI_REEXECUTION_RETURNS_EFFECTS = false

// Added after the latest landing time (signing + resend age cap + clock skew)
// before a checkpoint counts as past it: fullnode retries and node lag.
export const SUI_HEAD_MARGIN_MS: number = 5 * 60_000

// The head canary comes from this many checkpoints behind the tip (about
// 30 s on mainnet), so every backend behind a load-balanced RPC has it.
export const SUI_CANARY_TIP_OFFSET = 120n

// A lower bound of the checkpoint interval. Estimating a checkpoint for a
// time with it lands at or before that time.
export const SUI_MIN_CHECKPOINT_INTERVAL_MS = 200
