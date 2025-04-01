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
  return waitForResult(
    async () => {
      const callsDetails = await getAction(
        client,
        getCallsStatus,
        'getCallsStatus'
      )({
        id: batchHash,
      })

      // EIP-5792 specs was updated to return 100 for pending transactions https://eips.ethereum.org/EIPS/eip-5792
      if (
        callsDetails.status === 'PENDING' ||
        callsDetails.status === (100 as any)
      ) {
        return undefined
      }

      // EIP-5792 specs was updated to return 200 for confirmed transactions https://eips.ethereum.org/EIPS/eip-5792
      if (callsDetails.status === 'CONFIRMED' || callsDetails.status === 200) {
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

      if (callsDetails.status === 400) {
        throw new TransactionError(
          LiFiErrorCode.TransactionCanceled,
          'Transaction was canceled.'
        )
      }
      if (callsDetails.status === 500) {
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          'Transaction failed.'
        )
      }

      throw new TransactionError(
        LiFiErrorCode.TransactionNotFound,
        'Transaction not found.'
      )
    },
    5000,
    3,
    (_, error) => {
      return !(error instanceof TransactionError)
    }
  )
}
