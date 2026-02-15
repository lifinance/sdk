import {
  LiFiErrorCode,
  type SDKClient,
  TransactionError,
  waitForResult,
} from '@lifi/sdk'
import type { Address, Client, Hash, TransactionReceipt } from 'viem'
import { safeApiGet } from '../client/safeClient.js'
import type {
  SafeMultisigTransaction,
  SafeMultisigTransactionList,
} from '../client/types.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

function findMatchingTransaction(
  results: SafeMultisigTransaction[],
  signature: string
): { safeTxHash: Hash; nonce: number } | null {
  const normalized = signature.toLowerCase()
  for (const tx of results) {
    const hasMatch = tx.confirmations?.some(
      (conf) => conf.signature?.toLowerCase() === normalized
    )
    if (hasMatch) {
      return {
        safeTxHash: tx.safeTxHash as Hash,
        nonce: Number(tx.nonce),
      }
    }
  }
  return null
}

/**
 * Find a Safe transaction by matching the signature in confirmations
 */
async function findTransactionBySignature(
  chainId: number,
  safeAddress: Address,
  signature: string,
  apiKey?: string
): Promise<{ safeTxHash: Hash; nonce: number } | null> {
  const pendingTxs = await safeApiGet<SafeMultisigTransactionList>(
    chainId,
    `/api/v1/safes/${safeAddress}/multisig-transactions/?executed=false`,
    apiKey
  )

  const match = findMatchingTransaction(pendingTxs.results, signature)
  if (match) {
    return match
  }

  // Also check recent executed transactions in case it was already executed
  const allTxs = await safeApiGet<SafeMultisigTransactionList>(
    chainId,
    `/api/v1/safes/${safeAddress}/multisig-transactions/?limit=20`,
    apiKey
  )

  return findMatchingTransaction(allTxs.results, signature)
}

/**
 * Wait for a Safe transaction to be executed by polling the Safe Transaction Service.
 * Resolves the Safe signature to an on-chain transaction hash.
 */
export async function waitForSafeTransactionExecution(
  chainId: number,
  safeAddress: Address,
  signature: string,
  options?: {
    pollingInterval?: number
    timeout?: number
    safeApiKey?: string
  }
): Promise<Hash> {
  const basePollingInterval = options?.pollingInterval ?? 10_000
  const timeout = options?.timeout ?? 3_600_000 * 24 // 24 hours default
  const apiKey = options?.safeApiKey

  // First, find the transaction by signature
  const txInfo = await findTransactionBySignature(
    chainId,
    safeAddress,
    signature,
    apiKey
  )

  if (!txInfo) {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Safe transaction not found in Safe Transaction Service.'
    )
  }

  const { safeTxHash, nonce: originalNonce } = txInfo
  let pollCount = 0
  const startTime = Date.now()

  try {
    return await waitForResult<Hash>(
      async () => {
        pollCount++

        // Check elapsed time to enforce the actual timeout
        if (Date.now() - startTime > timeout) {
          throw new Error('Safe transaction polling timed out')
        }

        const tx = await safeApiGet<SafeMultisigTransaction>(
          chainId,
          `/api/v1/multisig-transactions/${safeTxHash}/`,
          apiKey
        )

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

        // Check if this transaction was replaced — only every 3rd poll to reduce API calls
        if (pollCount % 3 === 0) {
          try {
            const allTxs = await safeApiGet<SafeMultisigTransactionList>(
              chainId,
              `/api/v1/safes/${safeAddress}/multisig-transactions/`,
              apiKey
            )
            const executedWithSameOrHigherNonce = allTxs.results.find(
              (t) =>
                t.isExecuted &&
                Number(t.nonce) >= originalNonce &&
                t.safeTxHash !== safeTxHash
            )
            if (executedWithSameOrHigherNonce) {
              throw new TransactionError(
                LiFiErrorCode.TransactionCanceled,
                'Safe transaction was replaced by another transaction.'
              )
            }
          } catch (error) {
            if (error instanceof TransactionError) {
              throw error
            }
            // Ignore other errors when checking for replacement
          }
        }

        return undefined
      },
      // Dynamic backoff: 10s → 30s, increasing by 2s each poll
      (poll) => Math.min(basePollingInterval + poll * 2_000, 30_000),
      Number.MAX_SAFE_INTEGER,
      () => true
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

/**
 * Wait for a Safe transaction to be executed and return the on-chain transaction receipt.
 * This combines polling the Safe Transaction Service and waiting for blockchain confirmation.
 */
export async function waitForSafeTransactionReceipt(
  client: SDKClient,
  options: {
    viemClient: Client
    chainId: number
    safeAddress: Address
    signature: string
    pollingInterval?: number
    safeApiKey?: string
  }
): Promise<TransactionReceipt | undefined> {
  const resolvedTxHash = await waitForSafeTransactionExecution(
    options.chainId,
    options.safeAddress,
    options.signature,
    {
      pollingInterval: options.pollingInterval,
      safeApiKey: options.safeApiKey,
    }
  )

  // Wait for actual blockchain confirmation
  return await waitForTransactionReceipt(client, {
    client: options.viemClient,
    chainId: options.chainId,
    txHash: resolvedTxHash,
  })
}
