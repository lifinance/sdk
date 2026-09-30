import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError } from '../errors/errors.js'
import type {
  ExecutionAction,
  ExecutionActionType,
  LiFiStepExtended,
} from '../types/core.js'

/** Action types that carry the step's own transaction. */
export const TRANSACTION_ACTION_TYPES: readonly ExecutionActionType[] = [
  'SWAP',
  'CROSS_CHAIN',
]

/**
 * Stored bytes on a chain without its own expiry (Sui, Solana with a durable
 * nonce) are resent only this long after signing. Past it, a page load could
 * otherwise execute a swap on a quote the user no longer expects.
 */
export const MAX_RESEND_AGE_MS = 120_000

/**
 * Without an expiry verdict, a signature younger than this is never declared
 * dropped. Solana blockhashes and Tron transactions expire well before it.
 */
export const DROPPED_FALLBACK_AGE_MS = 300_000

/**
 * Subtracted from `execution.signedAt` (the device clock) when it anchors a
 * history-coverage check, so a device clock that runs fast cannot make a node
 * look like it covers the signing time when it does not.
 */
export const CLOCK_SKEW_MARGIN_MS = 600_000

/**
 * Fields a sign task clears before it writes a new transaction's data, and
 * that re-initializing a final-failed action clears. `taskId` is included: a
 * stale relayed or batched task id would otherwise keep the action open.
 */
export const CLEARED_TRANSACTION_FIELDS: Readonly<
  Pick<ExecutionAction, 'txHash' | 'txLink' | 'txHex' | 'txFinal' | 'taskId'>
> = Object.freeze({
  txHash: undefined,
  txLink: undefined,
  txHex: undefined,
  txFinal: undefined,
  taskId: undefined,
})

/**
 * True when the action holds transaction data that may still land: a hash, a
 * task id or stored signed bytes, unless the action FAILED with a final
 * outcome. Every resume decision uses this one predicate, so the pipeline
 * selector and the pre-sign guard can never disagree.
 */
export function hasOpenTransaction(action?: ExecutionAction): boolean {
  if (!action) {
    return false
  }
  if (!(action.txHash || action.taskId || action.txHex)) {
    return false
  }
  return !(action.status === 'FAILED' && action.txFinal === true)
}

/** True when any SWAP / CROSS_CHAIN action of the step has an open transaction. */
export function hasStepOpenTransaction(step: LiFiStepExtended): boolean {
  return !!step.execution?.actions?.some(
    (action) =>
      TRANSACTION_ACTION_TYPES.includes(action.type) &&
      hasOpenTransaction(action)
  )
}

/**
 * Walks the error and its `cause` chain. Parsers may rebuild errors, so the
 * marker is read from the original error. A property check instead of
 * `instanceof` keeps it working across duplicated installs.
 */
export function isFinalTransactionError(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if ((current as { final?: unknown }).final === true) {
      return true
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Called first in every sign task. With correct pipeline selectors it never
 * throws; it stops a second signature if a selector ever routes an open
 * transaction back to signing.
 */
export function assertNoOpenTransaction(action?: ExecutionAction): void {
  if (hasOpenTransaction(action)) {
    throw new TransactionError(
      LiFiErrorCode.TransactionConflict,
      'A transaction for this step was already signed and may still land. Resume the route to wait for it instead of signing a new one.'
    )
  }
}

/** Unknown signing time never allows a resend. */
export function isResendAllowed(
  signedAt: number | undefined,
  now: number = Date.now()
): boolean {
  return signedAt !== undefined && now - signedAt < MAX_RESEND_AGE_MS
}

/** Unknown signing time never allows a drop. */
export function isOldEnoughToDrop(
  signedAt: number | undefined,
  now: number = Date.now()
): boolean {
  return signedAt !== undefined && now - signedAt > DROPPED_FALLBACK_AGE_MS
}
