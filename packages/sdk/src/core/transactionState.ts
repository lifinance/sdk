import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError } from '../errors/errors.js'
import type {
  ExecutionAction,
  ExecutionActionType,
  LiFiStepExtended,
} from '../types/core.js'

/**
 * Action types that carry the step's own transaction.
 *
 * @internal
 */
export const TRANSACTION_ACTION_TYPES: readonly ExecutionActionType[] = [
  'SWAP',
  'CROSS_CHAIN',
]

/**
 * Stored bytes on a chain without its own expiry (Sui, Solana with a durable
 * nonce, Bitcoin) are resent only this long after signing. Past it, a page
 * load could otherwise execute a swap on a quote the user no longer expects.
 *
 * @internal
 */
export const MAX_RESEND_AGE_MS = 120_000

/**
 * Without an expiry verdict, a signature younger than this is never declared
 * dropped. Solana blockhashes and Tron transactions expire well before it.
 *
 * @internal
 */
export const DROPPED_FALLBACK_AGE_MS = 300_000

/**
 * Subtracted from `execution.signedAt` (the device clock) when it anchors a
 * history-coverage check, so a device clock that runs fast cannot make a node
 * look like it covers the signing time when it does not.
 *
 * @internal
 */
export const CLOCK_SKEW_MARGIN_MS = 600_000

/**
 * Fields a sign task clears before it writes a new transaction's data, and
 * that re-initializing a final-failed action clears. `taskId` is included: a
 * stale relayed or batched task id would otherwise keep the action open.
 * `callCount` goes with a batched task id.
 *
 * @internal
 */
export const CLEARED_TRANSACTION_FIELDS: Readonly<
  Pick<
    ExecutionAction,
    'txHash' | 'txLink' | 'txHex' | 'txFinal' | 'taskId' | 'callCount'
  >
> = Object.freeze({
  txHash: undefined,
  txLink: undefined,
  txHex: undefined,
  txFinal: undefined,
  taskId: undefined,
  callCount: undefined,
})

/**
 * True when the action has a transaction to follow, landed or not: a hash, a
 * task id or stored signed bytes, unless the action FAILED with a final
 * outcome. Every resume decision uses this one predicate, so the pipeline
 * selector and the pre-sign guard can never disagree.
 *
 * Resume rules for providers. A step never signs or sends a second
 * transaction while an earlier one can still land:
 * 1. Pick the first task with this predicate: open and DONE, the status
 *    wait; open, the provider's wait task; otherwise the first task.
 * 2. In the sign task, call `assertNoOpenTransaction` at the start, right
 *    before each wallet call and, where the SDK sends, right after the
 *    wallet returns. Write the new data with `CLEARED_TRANSACTION_FIELDS`
 *    and `signedAt`.
 * 3. From the last check, nothing awaits until the send or, where the SDK
 *    sends signed bytes, until they are stored as `txHex`, before the first
 *    send. Clear `txHex` only when the outcome is known, no node can still
 *    hold the bytes, or they no longer decode. A wallet that reported a
 *    bundle with a stored `callCount` of 1 in the same wait and then has no
 *    record of it, within 10 minutes of signing, never sent it: clear with
 *    `CLEARED_TRANSACTION_FIELDS` and throw without the marker.
 * 4. A resume never signs. It looks the transaction up and resends the
 *    stored bytes only while `isResendAllowed` (or the chain's own expiry)
 *    allows it; otherwise it only waits.
 * 5. Mark an error final only on a verdict about the transaction: failed
 *    or reverted (on chain or at the relayer), cancelled, replaced, or
 *    dropped with proof. Dropped needs all three: the transaction can no
 *    longer land, a node that covers its window reports it absent (in the
 *    same response where the chain allows it), and `isKnownToStatusApi` is
 *    false. In doubt, throw without the marker and keep the fields.
 * 6. Give `context.signal` only to waits that start after the broadcast. On
 *    abort, return `PAUSED` and write nothing.
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

/**
 * True when any SWAP / CROSS_CHAIN action of the step has an open transaction.
 *
 * @internal
 */
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
 *
 * @internal
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
 * The error of a step that would sign a second transaction while its first
 * one may still land.
 *
 * @internal
 */
export function transactionConflictError(): TransactionError {
  return new TransactionError(
    LiFiErrorCode.TransactionConflict,
    'A transaction for this step was already signed and may still land. Resume the route to wait for it instead of signing a new one.'
  )
}

/**
 * Called first in every sign task. With correct pipeline selectors it never
 * throws; it stops a second signature if a selector ever routes an open
 * transaction back to signing. Every sign task calls it again on the freshly
 * found action right before its wallet call: a late write of an older run can
 * merge a transaction into the action during the awaits in between. A sign
 * task that sends the transaction itself calls it once more after the wallet
 * returns, before it writes or sends anything: the merge can also land while
 * the prompt is open.
 *
 * @internal
 */
export function assertNoOpenTransaction(action?: ExecutionAction): void {
  if (hasOpenTransaction(action)) {
    throw transactionConflictError()
  }
}

/**
 * Unknown signing time never allows a resend. Nor does a signing time in the
 * future: a device clock that ran ahead at signing and was corrected later
 * would otherwise stretch the cap by the clock error.
 *
 * @internal
 */
export function isResendAllowed(
  signedAt: number | undefined,
  now: number = Date.now()
): boolean {
  return (
    signedAt !== undefined &&
    now >= signedAt &&
    now - signedAt < MAX_RESEND_AGE_MS
  )
}

/**
 * Unknown signing time never allows a drop.
 *
 * @internal
 */
export function isOldEnoughToDrop(
  signedAt: number | undefined,
  now: number = Date.now()
): boolean {
  return signedAt !== undefined && now - signedAt > DROPPED_FALLBACK_AGE_MS
}
