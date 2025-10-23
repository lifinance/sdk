import type {
  ExtendedTransactionInfo,
  FullStatusData,
  LiFiStep,
} from '@lifi/types'
import type { Hash } from 'viem'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { getRelayedTransactionStatus } from '../../services/api.js'
import { waitForResult } from '../../utils/waitForResult.js'
import type { WalletCallReceipt } from './types.js'

export const waitForRelayedTransactionReceipt = async (
  taskId: Hash,
  step: LiFiStep
): Promise<WalletCallReceipt> => {
  return waitForResult(
    async () => {
      const result = await getRelayedTransactionStatus({
        taskId,
        fromChain: step.action.fromChainId,
        toChain: step.action.toChainId,
        ...(step.tool !== 'custom' && { bridge: step.tool }),
      }).catch((e) => {
        if (process.env.NODE_ENV === 'development') {
          console.debug('Fetching status from relayer failed.', e)
        }
        return undefined
      })

      switch (result?.status) {
        case 'PENDING':
          return undefined
        case 'DONE': {
          const sending: ExtendedTransactionInfo | undefined =
            (result?.transactionStatus?.sending as ExtendedTransactionInfo) ||
            ((result as unknown as FullStatusData)
              ?.sending as ExtendedTransactionInfo)
          return {
            status: 'success',
            gasUsed: sending?.gasUsed,
            transactionHash: result?.metadata.txHash || sending?.txHash,
            transactionLink: sending?.txLink,
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
      return !(
        error instanceof TransactionError &&
        error.code === LiFiErrorCode.TransactionFailed
      )
    }
  )
}
