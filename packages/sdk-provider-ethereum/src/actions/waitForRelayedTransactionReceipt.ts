import type { SDKClient } from '@lifi/sdk'
import {
  type ExtendedTransactionInfo,
  type FullStatusData,
  getRelayedTransactionStatus,
  LiFiErrorCode,
  type LiFiStep,
  TransactionError,
  waitForResult,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import type { WalletCallReceipt } from '../types.js'

/**
 * Polls the relayer until the relayed transaction is done or has failed.
 *
 * @param client - {@link SDKClient}
 * @param taskId - The relayer task id.
 * @param step - The step the task belongs to.
 * @param timeout - How long to wait for a result in milliseconds. Defaults to 24 hours.
 * @param signal - Ends the wait: no status request starts after it aborts, and the request in flight and the sleep end at once.
 * @returns The receipt of the relayed transaction.
 * @throws {TransactionError} If the transaction failed, was not found, or no result arrived before the timeout. Only the failed transaction is a final outcome.
 * @throws The abort reason of `signal` once it aborts.
 */
export const waitForRelayedTransactionReceipt = async (
  client: SDKClient,
  taskId: Hash,
  step: LiFiStep,
  timeout: number = 3_600_000 * 24,
  signal?: AbortSignal
): Promise<WalletCallReceipt> => {
  const startTime = Date.now()
  return waitForResult(
    async () => {
      // Without this check, a task that stays PENDING is polled forever:
      // PENDING is not an error, so the retry limit does not apply.
      // TransactionFailed is not retried, so this ends the poll. Not final:
      // the relayer may still execute the task, so the action keeps its task
      // id and a resume waits for it again instead of signing a new one.
      if (Date.now() - startTime > timeout) {
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          'Relayed transaction timed out waiting for a result.'
        )
      }

      const result = await getRelayedTransactionStatus(
        client,
        {
          taskId,
          fromChain: step.action.fromChainId,
          toChain: step.action.toChainId,
          ...(step.tool !== 'custom' && { bridge: step.tool }),
        },
        { signal }
      ).catch((e) => {
        // A request that the abort ended is no failure of the relayer.
        if (process.env.NODE_ENV === 'development' && !signal?.aborted) {
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
            'Transaction was reverted.',
            undefined,
            { final: true }
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
    },
    signal
  )
}
