import {
  CLOCK_SKEW_MARGIN_MS,
  isKnownToStatusApi,
  LiFiErrorCode,
  type LiFiStepExtended,
  type SDKClient,
  TransactionError,
} from '@lifi/sdk'
import { type Transaction, TransactionBuilder } from '@stellar/stellar-sdk'
import {
  proveStellarTransactionAbsent,
  type StellarLandingWindow,
} from './proveStellarTransactionAbsent.js'

export interface StellarSubmitFailureContext {
  client: SDKClient
  step: LiFiStepExtended
  /** Hash of the signed envelope, persisted before the submit. */
  transactionHash: string
  /** The signed envelope (base64 XDR) that was submitted. */
  signedTxXdr: string
  networkPassphrase: string
}

/**
 * When the envelope could have been applied, in chain time (unix seconds).
 *
 * The earliest landing time is the envelope's `minTime` when it has one (> 0).
 * Otherwise it is `execution.signedAt - CLOCK_SKEW_MARGIN_MS`: `signedAt` comes
 * from the local clock, and the margin covers its skew against ledger time. The
 * function returns `undefined` when the envelope has no `maxTime` (it never
 * expires), when neither anchor exists, or when the envelope does not decode.
 * In each of these cases absence cannot be proven.
 */
const getLandingWindow = (
  signedTxXdr: string,
  networkPassphrase: string,
  signedAt: number | undefined
): StellarLandingWindow | undefined => {
  let timeBounds: Transaction['timeBounds']
  try {
    timeBounds = (
      TransactionBuilder.fromXdr(signedTxXdr, networkPassphrase) as Transaction
    ).timeBounds
  } catch {
    return undefined
  }

  const maxTime = Number(timeBounds?.maxTime ?? 0)
  if (!(maxTime > 0)) {
    return undefined
  }

  const minTime = Number(timeBounds?.minTime ?? 0)
  if (minTime > 0) {
    return { earliest: minTime, maxTime }
  }
  if (signedAt === undefined) {
    return undefined
  }
  return {
    earliest: Math.floor((signedAt - CLOCK_SKEW_MARGIN_MS) / 1000),
    maxTime,
  }
}

/**
 * Decides whether a failed submission is a final outcome, and returns the error
 * to throw (spec 4.2.8 and 4.3).
 *
 * Only a rejection can be final: `submitStellarTransaction` throws
 * `TransactionFailed` for a status other than PENDING, DUPLICATE or
 * TRY_AGAIN_LATER. A rejection alone proves nothing, because a failover
 * re-submit of an envelope that was already applied is rejected as well (for
 * example txBAD_SEQ). A rejection is final only when:
 * - a node answers NOT_FOUND in a response that itself covers the whole
 *   landing window of the envelope (see {@link proveStellarTransactionAbsent}),
 *   so the envelope was never applied and can no longer be; and
 * - the LI.FI status API does not know the hash. That check is a veto only. A
 *   miss (HTTP 404 or an error) says nothing.
 *
 * Transport errors, `RateLimitExceeded`, decode errors and every inconclusive
 * check return `error` itself, so the outcome stays unknown and a resume checks
 * again. Code and message never change.
 */
export const classifySubmitFailure = async (
  {
    client,
    step,
    transactionHash,
    signedTxXdr,
    networkPassphrase,
  }: StellarSubmitFailureContext,
  error: unknown
): Promise<unknown> => {
  if (
    !(error instanceof TransactionError) ||
    error.code !== LiFiErrorCode.TransactionFailed
  ) {
    return error
  }

  const window = getLandingWindow(
    signedTxXdr,
    networkPassphrase,
    step.execution?.signedAt
  )
  if (!window) {
    return error
  }

  if (!(await proveStellarTransactionAbsent(client, transactionHash, window))) {
    return error
  }

  if (await isKnownToStatusApi(client, step, transactionHash)) {
    return error
  }

  return new TransactionError(error.code, error.message, error, {
    final: true,
  })
}
