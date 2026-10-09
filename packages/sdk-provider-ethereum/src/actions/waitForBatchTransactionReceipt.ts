import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { type Client, type Hash, UnknownBundleIdError } from 'viem'
import { type GetCallsStatusReturnType, waitForCallsStatus } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { WalletCallReceipt } from '../types.js'

// Some wallets answer from a remote service that can forget an old bundle.
const DROPPED_BUNDLE_MAX_AGE_MS = 10 * 60_000

const isUnknownBundleIdError = (error: any): boolean =>
  error?.name === 'UnknownBundleIdError' ||
  error?.cause?.name === 'UnknownBundleIdError' ||
  error?.code === UnknownBundleIdError.code

/**
 * Unknown signing time is never in the window. Nor is a signing time in the
 * future, as in `isResendAllowed`.
 */
const isWithinDropWindow = (signedAt: number | undefined): boolean => {
  const now = Date.now()
  return (
    signedAt !== undefined &&
    now >= signedAt &&
    now - signedAt < DROPPED_BUNDLE_MAX_AGE_MS
  )
}

/**
 * Waits until the wallet reports the EIP-5792 call bundle as done or failed.
 *
 * MetaMask returns the id of a single-call bundle before the user approves
 * it, and removes the bundle on a reject: `wallet_getCallsStatus` then fails
 * with 5730 (`UnknownBundleIdError`). It returns the id of a bundle of two or
 * more calls only after it sent the bundle. Thus the SDK treats a bundle as
 * never sent only when all of these are true: its stored `callCount` is 1,
 * the wallet answered for it in this wait and then has no record of it, and
 * this happens within `DROPPED_BUNDLE_MAX_AGE_MS` of signing.
 *
 * @param client - The wallet client that sent the bundle.
 * @param batchHash - The bundle id that `wallet_sendCalls` returned.
 * @param options.onFailed - Gets the wallet's answer for a failed bundle, before the error is thrown.
 * @param options.signedAt - The signing time of the step (`execution.signedAt`).
 * @param options.callCount - The stored number of calls of the bundle (`action.callCount`).
 * @returns The receipt of the last call of the bundle.
 * @throws {TransactionError} If the bundle failed, was canceled, or the wallet has no record of it. A bundle that the SDK treats as never sent is a final `SignatureRejected`. Any other bundle without a record is `CallBundleNotFound`, which is not final.
 * @throws Any other error of the wallet, unchanged.
 */
export const waitForBatchTransactionReceipt = async (
  client: Client,
  batchHash: Hash,
  {
    onFailed,
    signedAt,
    callCount,
  }: {
    onFailed?: (result: GetCallsStatusReturnType) => void
    signedAt?: number
    callCount?: number
  } = {}
): Promise<WalletCallReceipt> => {
  let known = false
  let result: GetCallsStatusReturnType
  try {
    result = await getAction(
      client,
      waitForCallsStatus,
      'waitForCallsStatus'
    )({
      id: batchHash,
      timeout: 3_600_000 * 24,
      // viem's default, and a record that the wallet answered for this id.
      // viem shares one poll between waits for the same client and id, and
      // calls only the predicate of the wait that started it.
      status: ({ statusCode }) => {
        known = true
        return statusCode === 200 || statusCode >= 300
      },
    })
  } catch (error) {
    if (!isUnknownBundleIdError(error)) {
      throw error
    }
    // MetaMask removes a single-call bundle in this way only before it sends
    // it. The SDK treats the bundle as never sent: a final rejection, so
    // "Try again" signs anew.
    if (known && callCount === 1 && isWithinDropWindow(signedAt)) {
      throw new TransactionError(
        LiFiErrorCode.SignatureRejected,
        'The wallet removed the call bundle before it sent it.',
        error as Error,
        { final: true }
      )
    }
    // Unknown from the first answer (a reload after the reject, another
    // wallet), too long after signing, or no stored count of one call (two
    // or more calls, or a route stored without the count): the bundle may
    // still land.
    throw new TransactionError(
      LiFiErrorCode.CallBundleNotFound,
      'The wallet has no record of the call bundle.',
      error as Error
    )
  }

  if (result.status === 'success') {
    if (result.receipts?.some((receipt) => receipt.status === 'reverted')) {
      onFailed?.(result)
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'Transaction was reverted.',
        undefined,
        { final: true }
      )
    }
    // The wallet reports the batch as executed, but without a complete set of
    // receipts we cannot prove the outcome: it stays unknown.
    if (
      !result.receipts?.length ||
      !result.receipts.every((receipt) => receipt.transactionHash)
    ) {
      onFailed?.(result)
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'Transaction was reverted.'
      )
    }
    const transactionReceipt = result.receipts.at(-1)!
    return transactionReceipt
  }
  if (result.statusCode >= 400 && result.statusCode < 500) {
    onFailed?.(result)
    throw new TransactionError(
      LiFiErrorCode.TransactionCanceled,
      'Transaction was canceled.',
      undefined,
      { final: true }
    )
  }
  onFailed?.(result)
  // Only 500 (reverted completely) is final. Some calls of a partial batch
  // (600) may be onchain, and other codes are undefined: the outcome is unknown.
  if (result.statusCode === 500) {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction failed.',
      undefined,
      { final: true }
    )
  }
  throw new TransactionError(
    LiFiErrorCode.TransactionFailed,
    'Transaction failed.'
  )
}
