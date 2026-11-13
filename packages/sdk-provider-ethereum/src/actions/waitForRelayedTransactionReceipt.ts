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
import { getTransactionReceipt } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getPublicClient } from '../client/publicClient.js'
import type { WalletCallReceipt } from '../types.js'

/**
 * Status errors in a row that end the wait. A failed request, `NOT_FOUND`, the
 * 422/1004 answer of a failed lookup and a source receipt that cannot be
 * loaded each count; a PENDING answer resets the count, so a long relay does
 * not collect errors over its whole wait.
 */
const MAX_STATUS_ERRORS = 5

/** The on-chain outcome of a source transaction, or `undefined` when its receipt cannot be loaded. */
const getSourceOutcome = async (
  client: SDKClient,
  chainId: number,
  hash: Hash
): Promise<'success' | 'reverted' | undefined> => {
  try {
    const publicClient = await getPublicClient(client, chainId)
    const receipt = await getAction(
      publicClient,
      getTransactionReceipt,
      'getTransactionReceipt'
    )({ hash })
    return receipt.status
  } catch {
    return undefined
  }
}

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
  const isCrossChain = step.action.fromChainId !== step.action.toChainId
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

      // A gasless answer is the transfer status of `/v1/status`: it reports
      // the relayed source transaction in `sending` once the relayer sent it.
      // Only a bridge transfer ends the wait at its source; on one chain the
      // relayed transaction is the whole transfer.
      const gaslessStatus = isGasless
        ? (result as unknown as FullStatusData | undefined)
        : undefined
      const bridgeSource =
        isCrossChain && gaslessStatus?.sending?.txHash
          ? ({
              status: 'success',
              transactionHash: gaslessStatus.sending.txHash,
              transactionLink: gaslessStatus.sending.txLink,
            } as unknown as WalletCallReceipt)
          : undefined

      const statusError = (error: TransactionError): undefined => {
        statusErrors++
        if (statusErrors < MAX_STATUS_ERRORS) {
          return undefined
        }
        throw error
      }

      switch (result?.status) {
        case 'PENDING':
          statusErrors = 0
          // A gasless bridge transfer whose source transaction landed waits for
          // its destination. The source wait ends here, so a later bridge
          // failure reaches the status task, not the FAILED below.
          return gaslessStatus?.substatus === 'WAIT_DESTINATION_TRANSACTION'
            ? bridgeSource
            : undefined
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
          // FAILED with a hash is mostly a relayed source transaction that
          // reverted and moved nothing, so a resume may sign again. A bridge
          // can also fail after its source landed: the tokens left the wallet,
          // and a resume must not sign and relay a second transfer. The status
          // task follows that transfer, as for any bridge. The source receipt
          // tells the two apart.
          if (bridgeSource) {
            const outcome = await getSourceOutcome(
              client,
              step.action.fromChainId,
              bridgeSource.transactionHash
            )
            if (outcome === 'success') {
              return bridgeSource
            }
            if (outcome === undefined) {
              // The node may not have the receipt yet, so this counts as a
              // status error. Not final: a resume waits for the same task and
              // checks again.
              return statusError(
                new TransactionError(
                  LiFiErrorCode.TransactionFailed,
                  'The relayed transaction failed, and its source transaction could not be checked.'
                )
              )
            }
          }
          throw new TransactionError(
            LiFiErrorCode.TransactionFailed,
            'Transaction was reverted.',
            undefined,
            { final: true }
          )
        default:
          return statusError(
            new TransactionError(
              LiFiErrorCode.TransactionNotFound,
              'Transaction not found.'
            )
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
