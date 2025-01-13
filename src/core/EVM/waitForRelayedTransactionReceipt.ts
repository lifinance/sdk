import type { ExtendedTransactionInfo } from '@lifi/types'
import type { Hash, WalletCallReceipt as _WalletCallReceipt } from 'viem'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { getRelayedTransactionStatus } from '../../services/api.js'
import { waitForResult } from '../../utils/waitForResult.js'

export type WalletCallReceipt = _WalletCallReceipt<
  bigint,
  'success' | 'reverted'
>

export const waitForRelayedTransactionReceipt = async (
  taskId: Hash
): Promise<WalletCallReceipt> => {
  return waitForResult(
    async () => {
      const result = await getRelayedTransactionStatus({
        taskId,
      }).catch((e) => {
        if (process.env.NODE_ENV === 'development') {
          console.debug('Fetching status from relayer failed.', e)
        }
        return undefined
      })

      switch (result?.data.status) {
        case 'PENDING':
          return undefined
        case 'DONE': {
          const sending: ExtendedTransactionInfo | undefined = result?.data
            .transactionStatus?.sending as ExtendedTransactionInfo
          return {
            status: 'success',
            gasUsed: sending?.gasUsed,
            transactionHash: result?.data.metadata.txHash,
          } as unknown as WalletCallReceipt
        }
        case 'FAILED':
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            'Transaction was reverted.'
          )
        default:
          throw new TransactionError(
            LiFiErrorCode.TransactionNotFound,
            'Transaction not found.'
          )
      }
    },
    5000,
    3,
    (_, error) => {
      return !(error instanceof TransactionError)
    }
  )
}
