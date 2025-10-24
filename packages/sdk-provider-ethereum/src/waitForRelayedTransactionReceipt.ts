import type { SDKClient } from '@lifi/sdk'
import {
  type ExtendedTransactionInfo,
  getRelayedTransactionStatus,
  LiFiErrorCode,
  type LiFiStep,
  TransactionError,
  waitForResult,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import type { WalletCallReceipt } from './types.js'

export const waitForRelayedTransactionReceipt = async (
  client: SDKClient,
  taskId: Hash,
  step: LiFiStep
): Promise<WalletCallReceipt> => {
  return waitForResult(
    async () => {
      const result = await getRelayedTransactionStatus(client, {
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
          const sending: ExtendedTransactionInfo | undefined = result
            ?.transactionStatus?.sending as ExtendedTransactionInfo
          return {
            status: 'success',
            gasUsed: sending?.gasUsed,
            transactionHash: result?.metadata.txHash,
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
