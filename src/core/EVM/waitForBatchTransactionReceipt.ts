import type { Client, Hash } from 'viem'
import { type GetCallsStatusReturnType, waitForCallsStatus } from 'viem/actions'
import { getAction } from 'viem/utils'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { WalletCallReceipt } from './types.js'

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
    if (
      !result.receipts?.length ||
      !result.receipts.every((receipt) => receipt.transactionHash) ||
      result.receipts.some((receipt) => receipt.status === 'reverted')
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
      'Transaction was canceled.'
    )
  }
  onFailed?.(result)
  throw new TransactionError(
    LiFiErrorCode.TransactionFailed,
    'Transaction failed.'
  )
}
