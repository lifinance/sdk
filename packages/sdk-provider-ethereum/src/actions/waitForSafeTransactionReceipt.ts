import {
  LiFiErrorCode,
  type SDKClient,
  TransactionError,
  waitForResult,
} from '@lifi/sdk'
import type { Address, Client, Hash, TransactionReceipt } from 'viem'
import {
  type SafeMultisigTransaction,
  type SafeMultisigTransactionList,
  safeApiGet,
} from '../client/safeClient.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

export interface WaitForSafeTransactionResult {
  safeTxHash: Hash
  transactionHash: Hash | null
  isExecuted: boolean
  isSuccessful: boolean | null
  status: 'executed' | 'pending' | 'replaced' | 'failed' | 'not_found'
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
  try {
    const pendingTxs = await safeApiGet<SafeMultisigTransactionList>(
      chainId,
      `/api/v1/safes/${safeAddress}/multisig-transactions/?executed=false`,
      apiKey
    )

    const normalizedSignature = signature.toLowerCase()
    for (const tx of pendingTxs.results) {
      const hasMatchingSignature = tx.confirmations?.some(
        (conf) => conf.signature?.toLowerCase() === normalizedSignature
      )
      if (hasMatchingSignature) {
        return {
          safeTxHash: tx.safeTxHash as Hash,
          nonce: Number(tx.nonce),
        }
      }
    }

    // Also check recent executed transactions in case it was already executed
    const allTxs = await safeApiGet<SafeMultisigTransactionList>(
      chainId,
      `/api/v1/safes/${safeAddress}/multisig-transactions/?limit=20`,
      apiKey
    )
    for (const tx of allTxs.results.slice(0, 20)) {
      const hasMatchingSignature = tx.confirmations?.some(
        (conf) => conf.signature?.toLowerCase() === normalizedSignature
      )
      if (hasMatchingSignature) {
        return {
          safeTxHash: tx.safeTxHash as Hash,
          nonce: Number(tx.nonce),
        }
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Wait for a Safe transaction to be executed by polling the Safe Transaction Service.
 * Returns the Safe API execution status, not the on-chain receipt.
 */
export async function waitForSafeTransactionExecution(
  chainId: number,
  safeAddress: Address,
  signature: string,
  options?: {
    pollingInterval?: number
    timeout?: number
    safeApiKey?: string
    onStatusUpdate?: (status: WaitForSafeTransactionResult) => void
  }
): Promise<WaitForSafeTransactionResult> {
  const basePollingInterval = options?.pollingInterval ?? 10_000
  const timeout = options?.timeout ?? 3_600_000 * 24 // 24 hours default
  const apiKey = options?.safeApiKey
  const maxRetries = Math.ceil(timeout / basePollingInterval)

  // First, find the transaction by signature
  const txInfo = await findTransactionBySignature(
    chainId,
    safeAddress,
    signature,
    apiKey
  )

  if (!txInfo) {
    return {
      safeTxHash: '0x' as Hash,
      transactionHash: null,
      isExecuted: false,
      isSuccessful: null,
      status: 'not_found',
    }
  }

  const { safeTxHash, nonce: originalNonce } = txInfo
  let pollCount = 0

  try {
    return await waitForResult<WaitForSafeTransactionResult>(
      async () => {
        pollCount++

        const tx = await safeApiGet<SafeMultisigTransaction>(
          chainId,
          `/api/v1/multisig-transactions/${safeTxHash}/`,
          apiKey
        )

        if (tx.isExecuted) {
          const result: WaitForSafeTransactionResult = {
            safeTxHash,
            transactionHash: tx.transactionHash as Hash | null,
            isExecuted: true,
            isSuccessful: tx.isSuccessful ?? null,
            status: tx.isSuccessful ? 'executed' : 'failed',
          }
          options?.onStatusUpdate?.(result)
          return result
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
              return {
                safeTxHash,
                transactionHash: null,
                isExecuted: false,
                isSuccessful: false,
                status: 'replaced' as const,
              }
            }
          } catch {
            // Ignore errors when checking for replacement
          }
        }

        options?.onStatusUpdate?.({
          safeTxHash,
          transactionHash: null,
          isExecuted: false,
          isSuccessful: null,
          status: 'pending',
        })

        return undefined
      },
      // Dynamic backoff: 10s → 30s, increasing by 2s each poll
      (poll) => Math.min(basePollingInterval + poll * 2_000, 30_000),
      maxRetries,
      () => true
    )
  } catch {
    // maxRetries exhausted = timeout
    return {
      safeTxHash,
      transactionHash: null,
      isExecuted: false,
      isSuccessful: null,
      status: 'pending',
    }
  }
}

/**
 * Resolve a Safe signature to an on-chain transaction hash.
 * Polls the Safe Transaction Service until executed and handles all error cases internally.
 */
export async function resolveSafeTransactionHash(
  chainId: number,
  safeAddress: Address,
  signature: string,
  options?: { pollingInterval?: number; safeApiKey?: string }
): Promise<Hash> {
  const safeResult = await waitForSafeTransactionExecution(
    chainId,
    safeAddress,
    signature,
    {
      pollingInterval: options?.pollingInterval,
      safeApiKey: options?.safeApiKey,
    }
  )

  if (safeResult.status === 'replaced') {
    throw new TransactionError(
      LiFiErrorCode.TransactionCanceled,
      'Safe transaction was replaced by another transaction.'
    )
  }
  if (safeResult.status === 'not_found') {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Safe transaction not found in Safe Transaction Service.'
    )
  }
  if (safeResult.status === 'failed' || !safeResult.isSuccessful) {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Safe transaction failed.'
    )
  }
  if (!safeResult.transactionHash) {
    throw new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Safe transaction executed but no transaction hash returned.'
    )
  }

  return safeResult.transactionHash
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
  }
): Promise<TransactionReceipt | undefined> {
  const resolvedTxHash = await resolveSafeTransactionHash(
    options.chainId,
    options.safeAddress,
    options.signature,
    {
      pollingInterval: options.pollingInterval,
      safeApiKey: client.config.safeApiKey,
    }
  )

  // Wait for actual blockchain confirmation
  return await waitForTransactionReceipt(client, {
    client: options.viemClient,
    chainId: options.chainId,
    txHash: resolvedTxHash,
  })
}
