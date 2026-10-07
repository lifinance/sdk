import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import type { Client, Hash } from 'viem'
import { type GetCallsStatusReturnType, waitForCallsStatus } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { WalletCallReceipt } from '../types.js'

export const waitForBatchTransactionReceipt = async (
  client: Client,
  batchHash: Hash,
  onFailed?: (result: GetCallsStatusReturnType) => void
): Promise<WalletCallReceipt> => {
  const result = await getAction(
    client,
    waitForCallsStatus,
    'waitForCallsStatus'
  )({
    id: batchHash,
    timeout: 3_600_000 * 24,
  })

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
