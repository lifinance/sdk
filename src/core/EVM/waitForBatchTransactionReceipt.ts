import type {
  Client,
  Hash,
  WalletCallReceipt as _WalletCallReceipt,
} from 'viem'
import { waitForCallsStatus } from 'viem/actions'
import { getAction } from 'viem/utils'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'

export type WalletCallReceipt = _WalletCallReceipt<
  bigint,
  'success' | 'reverted'
>

export const waitForBatchTransactionReceipt = async (
  client: Client,
  batchHash: Hash
): Promise<WalletCallReceipt> => {
  const { receipts, status, statusCode } = await getAction(
    client,
    waitForCallsStatus,
    'waitForCallsStatus'
  )({
    id: batchHash,
    timeout: 300_000,
  })

  if (
    status === 'success' ||
    // @ts-expect-error: for backwards compatibility
    status === 'CONFIRMED'
  ) {
    if (
      !receipts?.length ||
      !receipts.every((receipt) => receipt.transactionHash) ||
      receipts.some((receipt) => receipt.status === 'reverted')
    ) {
      throw new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'Transaction was reverted.'
      )
    }
    const transactionReceipt = receipts.at(-1)!
    return transactionReceipt
  }
  if (statusCode >= 400 && statusCode < 500) {
    throw new TransactionError(
      LiFiErrorCode.TransactionCanceled,
      'Transaction was canceled.'
    )
  }
  throw new TransactionError(
    LiFiErrorCode.TransactionFailed,
    'Transaction failed.'
  )
}
