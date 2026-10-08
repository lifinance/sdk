import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { type Client, type Hash, UnknownBundleIdError } from 'viem'
import { type GetCallsStatusReturnType, waitForCallsStatus } from 'viem/actions'
import { getAction } from 'viem/utils'
import { CallBundleDroppedError } from '../errors/CallBundleDroppedError.js'
import type { WalletCallReceipt } from '../types.js'

// Some wallets answer from a remote service that can forget an old bundle.
const DROPPED_BUNDLE_MAX_AGE_MS = 10 * 60_000

const isUnknownBundleIdError = (error: any): boolean =>
  error?.name === 'UnknownBundleIdError' ||
  error?.cause?.name === 'UnknownBundleIdError' ||
  error?.code === UnknownBundleIdError.code

/**
 * Unknown signing time never proves a drop. Nor does a signing time in the
 * future, as in `isResendAllowed`.
 */
const isDropProvable = (
  signedAt: number | undefined,
  now: number = Date.now()
): boolean =>
  signedAt !== undefined &&
  now >= signedAt &&
  now - signedAt < DROPPED_BUNDLE_MAX_AGE_MS

export const waitForBatchTransactionReceipt = async (
  client: Client,
  batchHash: Hash,
  onFailed?: (result: GetCallsStatusReturnType) => void,
  signedAt?: number
): Promise<WalletCallReceipt> => {
  // MetaMask returns the id of a single-call bundle before the user approves
  // it, and removes the bundle on a reject: `wallet_getCallsStatus` then
  // fails with 5730 (`UnknownBundleIdError`).
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
    // The wallet answered for the bundle in this wait and then had no
    // record of it: it dropped the bundle before it sent it.
    if (known && isDropProvable(signedAt)) {
      throw new CallBundleDroppedError(error as Error)
    }
    // Unknown from the first answer (a reload after the reject, another
    // wallet), or too long after signing: the bundle may still land.
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
