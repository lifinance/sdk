import type { SDKClient } from '@lifi/sdk'
import {
  type ExtendedTransactionInfo,
  type FullStatusData,
  getRelayedTransactionStatus,
  getStatus,
  isGaslessStep,
  LiFiErrorCode,
  type LiFiStep,
  type RelayStatusResponseData,
  TransactionError,
  waitForResult,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import type { WalletCallReceipt } from '../types.js'

/**
 * Status errors in a row that end the wait. A failed request, `NOT_FOUND` and
 * the 422/1004 answer of a failed lookup each count; an answer resets the
 * count, so a long relay does not collect errors over its whole wait.
 */
const MAX_STATUS_ERRORS = 5

/**
 * Polls the relayer until the relayed transaction is done or has failed.
 *
 * @param client - {@link SDKClient}
 * @param taskId - The relayer task id.
 * @param step - The step the task belongs to.
 * @param timeout - How long to wait for a result in milliseconds. Defaults to 24 hours.
 * @param signal - Ends the wait: no status request starts after it aborts, and the request in flight and the sleep end at once.
 * @returns The receipt of the relayed transaction.
 * @throws {TransactionError} If the transaction failed, the status was not found after five status errors in a row, or no result arrived before the timeout. Only the failed transaction is a final outcome.
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
  const isGasless = isGaslessStep(step)
  let statusErrors = 0
  return waitForResult(
    async () => {
      // Without this check, a task that stays PENDING is polled forever:
      // PENDING is no status error, so the error limit does not apply. An
      // error the poll throws ends it. Not final:
      // the relayer may still execute the task, so the action keeps its task
      // id and a resume waits for it again instead of signing a new one.
      if (Date.now() - startTime > timeout) {
        throw new TransactionError(
          LiFiErrorCode.TransactionFailed,
          'Relayed transaction timed out waiting for a result.'
        )
      }

      // A gasless task id is a hash like a 1inch `Order` task id, so the step
      // selects the endpoint. The task id alone routes a gasless request: a
      // `bridge` would let a proxy such as the Jumper backend answer it with
      // its own order lookup. The cast is the one `getRelayedTransactionStatus`
      // makes for the Hyperliquid answer of the same endpoint.
      const result = await (isGasless
        ? (getStatus(
            client,
            { taskId },
            { signal }
          ) as unknown as Promise<RelayStatusResponseData>)
        : getRelayedTransactionStatus(
            client,
            {
              taskId,
              fromChain: step.action.fromChainId,
              toChain: step.action.toChainId,
              ...(step.tool !== 'custom' && { bridge: step.tool }),
            },
            { signal }
          )
      ).catch((e) => {
        // A request that the abort ended is no failure of the relayer.
        if (process.env.NODE_ENV === 'development' && !signal?.aborted) {
          console.debug('Fetching status from relayer failed.', e)
        }
        return undefined
      })

      switch (result?.status) {
        case 'PENDING':
          statusErrors = 0
          return undefined
        case 'DONE': {
          const sending: ExtendedTransactionInfo | undefined =
            (result?.transactionStatus?.sending as ExtendedTransactionInfo) ||
            ((result as unknown as FullStatusData)
              ?.sending as ExtendedTransactionInfo)
          return {
            status: 'success',
            gasUsed: sending?.gasUsed,
            transactionHash: result?.metadata?.txHash || sending?.txHash,
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
          statusErrors++
          if (statusErrors < MAX_STATUS_ERRORS) {
            return undefined
          }
          throw new TransactionError(
            LiFiErrorCode.TransactionNotFound,
            'Transaction not found.'
          )
      }
    },
    5000,
    undefined,
    // The poll counts its own status errors, so every error it throws ends
    // the wait.
    () => false,
    signal
  )
}
