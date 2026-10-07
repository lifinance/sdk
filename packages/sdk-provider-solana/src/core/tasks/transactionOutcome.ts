import {
  CLOCK_SKEW_MARGIN_MS,
  type ExecutionAction,
  isKnownToStatusApi,
  isOldEnoughToDrop,
  isResendAllowed,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Signature } from '@solana/kit'
import { lookupSignatureStatus } from '../../actions/lookupSignatureStatus.js'
import type { RaceResult } from '../../confirmation/raceRpcs.js'
import {
  isConfirmedCommitment,
  type SignatureStatus,
} from '../../confirmation/types.js'
import type { SolanaStepExecutorContext } from '../../types.js'
import type { TransactionLifetime } from '../../utils/getTransactionLifetime.js'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'
import {
  type ConfirmationMessages,
  confirmationError,
} from './confirmationError.js'

/** Explorer link for a signature, as both wait tasks write it. */
export function getTxLink(
  context: Pick<SolanaStepExecutorContext, 'fromChain'>,
  signature: string
): string {
  return `${context.fromChain.metamask.blockExplorerUrls[0]}tx/${signature}`
}

/**
 * May stored bytes be sent (again)? A blockhash transaction always: the
 * chain rejects it once the blockhash dies, and the deadline's probe tells
 * when. Anything else - a durable nonce, a lifetime that did not decode -
 * only inside the resend age cap, so a page load hours later cannot execute
 * a swap on an old quote.
 */
export function canResendStored(
  lifetimes: TransactionLifetime[],
  signedAt: number | undefined,
  now?: number
): boolean {
  const expiresOnItsOwn =
    lifetimes.length > 0 &&
    lifetimes.every((lifetime) => lifetime.kind === 'blockhash')
  return expiresOnItsOwn || isResendAllowed(signedAt, now)
}

/**
 * Condition (a) of the dropped rule in `resolveUnconfirmed`: the chain says
 * the transaction can no longer land.
 *
 * - An `expired` verdict: the blockhash probe saw it dead.
 * - Without a verdict, `isOldEnoughToDrop` for every lifetime. For a
 *   blockhash transaction that is the five-minute time fallback. For a
 *   durable nonce or an undecodable lifetime it is the age cap passed plus a
 *   margin: sends stop at the cap, and the three minutes after it put the
 *   lookup's current-slot head safely past any slot the transaction could
 *   still land in.
 *
 * An unknown signing time never holds by time.
 */
export function cannotLandAnymore(options: {
  expired: boolean
  signedAt: number | undefined
  now?: number
}): boolean {
  return options.expired || isOldEnoughToDrop(options.signedAt, options.now)
}

/** Drops the stored bytes: never sent, landed, or final. */
export function clearStoredTransactions(
  context: SolanaStepExecutorContext,
  action: ExecutionAction
): void {
  context.statusManager.updateAction(context.step, action.type, 'PENDING', {
    txHex: undefined,
  })
}

/** A signature status's `err` as the failure `recordLanded` takes. */
export function failureOf(
  status: Pick<SignatureStatus, 'err'>
): { err: unknown } | undefined {
  return status.err ? { err: status.err } : undefined
}

/**
 * Result rule for a transaction the chain has: writes `txHash` and `txLink`,
 * clears the stored bytes, then completes - or throws the final
 * `TransactionFailed` for one that failed on chain.
 *
 * The hash is written for a failed transaction too: it exists on chain, and
 * a resume that found it by lookup has no `txHash` yet.
 */
export function recordLanded(
  context: SolanaStepExecutorContext,
  action: ExecutionAction,
  options: { signature: Signature; failure: { err: unknown } | undefined }
): TaskResult {
  const { step, statusManager, isBridgeExecution } = context
  const { signature, failure } = options

  statusManager.updateAction(step, action.type, 'PENDING', {
    txHash: signature,
    txLink: getTxLink(context, signature),
    txHex: undefined,
  })

  if (failure) {
    const cause = new SolanaTransactionDetailsError(failure.err)
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      `Transaction failed: ${cause.message}`,
      cause,
      { final: true }
    )
  }

  if (isBridgeExecution) {
    statusManager.updateAction(step, action.type, 'DONE')
  }

  return { status: 'COMPLETED' }
}

/**
 * Decides what a transaction that did not confirm is: landed after all
 * (returns its status), dropped (throws a final `TransactionExpired`), or
 * unknown (rethrows `error`, the error the task built for today's outcome).
 *
 * Dropped (see the resume rules in `transactionState.ts`) = (a)
 * `cannotLandAnymore`, AND (b) a lookup that proves the absence - a covering
 * RPC whose head is past the landing window answered `null` in the same
 * response, and no RPC has the transaction - AND (c) the status API does not
 * know the hash. The status API only vetoes: it answers 404 for landed
 * transactions it does not index too, so a miss there proves nothing.
 */
export async function resolveUnconfirmed(
  context: SolanaStepExecutorContext,
  action: ExecutionAction,
  options: {
    signature: Signature
    /** What the integrator sees when the outcome stays unknown. */
    error: unknown
    /** The slot of the `expired` verdict; `undefined` without one. */
    expiredAtSlot: bigint | undefined
    messages: ConfirmationMessages
  }
): Promise<SignatureStatus> {
  const { client, step } = context
  const { signature, error, expiredAtSlot } = options
  const signedAt = step.execution?.signedAt

  // (a) The local check runs first, so a young transaction costs no request.
  if (!cannotLandAnymore({ expired: expiredAtSlot !== undefined, signedAt })) {
    throw error
  }
  // Without a signing time there is no anchor, so no canary can prove that a
  // node's history covers the transaction.
  if (signedAt === undefined) {
    throw error
  }

  // (b) Absence, proven by the same response that proves coverage and head.
  // Every other lookup result - also `unknown` with `answered: false`, an
  // outage - keeps the outcome unknown.
  const lookup = await lookupSignatureStatus(client, signature, {
    anchor: signedAt - CLOCK_SKEW_MARGIN_MS,
    expiredAtSlot,
  })
  if (
    lookup.kind === 'found' &&
    isConfirmedCommitment(lookup.status.confirmationStatus)
  ) {
    return lookup.status
  }
  if (lookup.kind !== 'not-found') {
    throw error
  }

  // (c) The veto.
  if (await isKnownToStatusApi(client, step, signature)) {
    throw error
  }

  clearStoredTransactions(context, action)
  // Today's expiry code and text: only the marker is new.
  throw new TransactionError(
    LiFiErrorCode.TransactionExpired,
    options.messages.notConfirmed,
    error instanceof Error ? error : undefined,
    { final: true }
  )
}

/**
 * The send-and-settle tail both wait tasks share: runs `send`, then applies
 * the result rules to what it reports.
 *
 * - A confirmation goes to `recordLanded`, with `confirmedFailure` reading
 *   its on-chain failure.
 * - Every other result - `rpc-unavailable` included - goes to
 *   `resolveUnconfirmed`. Only an `expired` verdict passes its slot: the
 *   dropped check reads any defined slot as a verdict.
 * - A rejection comes before the first send of this run. On the first run
 *   nothing ever left the SDK, so the bytes are cleared and the error is
 *   rethrown: "Try again" signs again. On a resume an earlier run may have
 *   sent the same bytes: they stay, and only the chain can make the outcome
 *   final.
 */
export async function sendAndSettle<T>(
  context: SolanaStepExecutorContext,
  action: ExecutionAction,
  options: {
    signature: Signature
    /** Sends and races the confirmation. Rejects only before its first
     * send; the race itself never rejects. */
    send: () => Promise<RaceResult<T>>
    /** The on-chain failure of a confirmed value. */
    confirmedFailure: (value: T) => { err: unknown } | undefined
    /** An earlier run may already have sent these bytes. */
    resuming: boolean
    messages: ConfirmationMessages
  }
): Promise<TaskResult> {
  const { signature, messages } = options

  /** `resolveUnconfirmed` throws for an unknown or dropped outcome, so only
   * a confirmed status reaches `recordLanded`. */
  const settleUnconfirmed = async (
    error: unknown,
    expiredAtSlot: bigint | undefined
  ): Promise<TaskResult> => {
    const status = await resolveUnconfirmed(context, action, {
      signature,
      error,
      expiredAtSlot,
      messages,
    })
    return recordLanded(context, action, {
      signature,
      failure: failureOf(status),
    })
  }

  let result: RaceResult<T>
  try {
    result = await options.send()
  } catch (error) {
    if (!options.resuming) {
      clearStoredTransactions(context, action)
      throw error
    }
    return settleUnconfirmed(error, undefined)
  }

  if (result.kind === 'confirmed') {
    return recordLanded(context, action, {
      signature,
      failure: options.confirmedFailure(result.value),
    })
  }

  return settleUnconfirmed(
    confirmationError(result, messages),
    // The head a covering RPC has to reach before its `null` counts.
    result.kind === 'expired' ? result.slot : undefined
  )
}
