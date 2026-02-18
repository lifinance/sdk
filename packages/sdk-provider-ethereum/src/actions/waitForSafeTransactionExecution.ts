import {
  LiFiErrorCode,
  type SDKClient,
  TransactionError,
  waitForResult,
} from '@lifi/sdk'
import type { Address, Hash } from 'viem'
import {
  getSafeTransaction,
  getSafeTransactions,
} from '../client/safeClient.js'

export interface WaitForSafeTransactionExecutionProps {
  chainId: number
  safeAddress: Address
  signature: string
  pollingInterval?: number
  timeout?: number
}

/**
 * Polls the Safe Transaction Service until the transaction matching the given signature
 * is executed, then resolves with the on-chain transaction hash.
 *
 * @param client - The SDK client
 * @param props - {@link WaitForSafeTransactionExecutionProps}
 * @returns The on-chain transaction hash once the Safe transaction is executed.
 * @throws {TransactionError} If the transaction fails, is replaced, or polling times out.
 */
export async function waitForSafeTransactionExecution(
  client: SDKClient,
  {
    chainId,
    safeAddress,
    signature,
    pollingInterval,
    timeout: timeoutMs,
  }: WaitForSafeTransactionExecutionProps
): Promise<Hash> {
  const basePollingInterval = pollingInterval ?? 10_000
  const timeout = timeoutMs ?? 3_600_000 * 24 // 24 hours default
  const { safeApiKey } = client.config

  let safeTxHash: Hash | undefined
  let originalNonce: number | undefined
  let pollCount = 0
  const normalizedSignature = signature.toLowerCase()
  const startTime = Date.now()

  try {
    return await waitForResult<Hash>(
      async () => {
        pollCount++

        if (Date.now() - startTime > timeout) {
          throw new Error('Safe transaction polling timed out')
        }

        // Resolve signature to safeTxHash
        if (!safeTxHash) {
          const { results } = await getSafeTransactions({
            chainId,
            safeAddress,
            apiKey: safeApiKey,
          })

          const match = results.find((tx) =>
            tx.confirmations?.some(
              (c) => c.signature?.toLowerCase() === normalizedSignature
            )
          )
          if (!match) {
            return undefined
          }
          safeTxHash = match.safeTxHash as Hash
          originalNonce = Number(match.nonce)
        }

        // single-tx lookup for execution status
        const tx = await getSafeTransaction({
          chainId,
          safeTxHash,
          apiKey: safeApiKey,
        })

        if (tx.isExecuted) {
          if (!tx.isSuccessful) {
            throw new TransactionError(
              LiFiErrorCode.TransactionFailed,
              'Safe transaction failed.'
            )
          }
          if (!tx.transactionHash) {
            throw new TransactionError(
              LiFiErrorCode.TransactionFailed,
              'Safe transaction executed but no transaction hash returned.'
            )
          }
          return tx.transactionHash as Hash
        }

        // Check for replacement every 3rd poll
        if (pollCount % 3 === 0) {
          const { results } = await getSafeTransactions({
            chainId,
            safeAddress,
            apiKey: safeApiKey,
          })
          const replaced = results.find(
            (t) =>
              t.isExecuted &&
              Number(t.nonce) >= originalNonce! &&
              t.safeTxHash !== safeTxHash
          )
          console.debug({ replaced, results })
          if (replaced) {
            throw new TransactionError(
              LiFiErrorCode.TransactionCanceled,
              'Safe transaction was replaced by another transaction.'
            )
          }
        }

        return undefined
      },
      // Dynamic backoff: 10s → 30s, increasing by 2s each poll
      (poll) => Math.min(basePollingInterval + poll * 2_000, 30_000),
      Number.MAX_SAFE_INTEGER,
      (_attempts, error) => !(error instanceof TransactionError)
    )
  } catch (error) {
    if (error instanceof TransactionError) {
      throw error
    }
    // Timeout or maxRetries exhausted
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Safe transaction timed out waiting for execution.'
    )
  }
}
