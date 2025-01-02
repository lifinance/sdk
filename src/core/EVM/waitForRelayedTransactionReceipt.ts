import type { Hash, WalletCallReceipt as _WalletCallReceipt } from 'viem'
import { getRelayedTransactionStatus } from '../../services/api.js'
import { waitForResult } from '../../utils/waitForResult.js'

export type WalletCallReceipt = _WalletCallReceipt<
  bigint,
  'success' | 'reverted'
>

export const waitForRelayedTransactionReceipt = async (
  taskId: Hash
): Promise<WalletCallReceipt> => {
  return waitForResult(async () => {
    const status = await getRelayedTransactionStatus({
      taskId,
    })

    // biome-ignore lint/suspicious/noConsole: <explanation>
    console.log('status', status)

    if (status.status === 'pending') {
      return status as any
    }

    return undefined

    // if (status.status === 'success') {
    //   if (
    //     !status.receipts?.length ||
    //     !status.receipts.every((receipt) => receipt.transactionHash) ||
    //     status.receipts.some((receipt) => receipt.status === 'reverted')
    //   ) {
    //     throw new TransactionError(
    //       LiFiErrorCode.TransactionFailed,
    //       'Transaction was reverted.'
    //     )
    //   }
    //   const transactionReceipt = callsDetails.receipts.at(-1)!
    //   return transactionReceipt
    // }

    // throw new TransactionError(
    //   LiFiErrorCode.TransactionFailed,
    //   'Transaction not found.'
    // )
  }, 3000)
}
