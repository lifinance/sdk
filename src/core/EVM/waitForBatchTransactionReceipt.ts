import type {
  Client,
  Hash,
  WalletCallReceipt as _WalletCallReceipt,
} from 'viem'
import { getCallsStatus } from 'viem/experimental'
import { getAction } from 'viem/utils'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { waitForResult } from '../../utils/waitForResult.js'

export type WalletCallReceipt = _WalletCallReceipt<
  bigint,
  'success' | 'reverted'
>

export const waitForBatchTransactionReceipt = async (
  client: Client,
  batchHash: Hash
): Promise<WalletCallReceipt> => {
  return waitForResult(async () => {
    const callsDetails = await getAction(
      client,
      getCallsStatus,
      'getCallsStatus'
    )({
      id: batchHash,
    })

    if (callsDetails.status === 'PENDING') {
      return undefined
    }

    if (callsDetails.status === 'CONFIRMED') {
      if (
        !callsDetails.receipts?.length ||
        !callsDetails.receipts.every((receipt) => receipt.transactionHash) ||
        callsDetails.receipts.some((receipt) => receipt.status === 'reverted')
      ) {
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          'Transaction was reverted.'
        )
      }
      const transactionReceipt = callsDetails.receipts.at(-1)!
      return transactionReceipt
    }

    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction not found.'
    )
  }, 3000)
}
