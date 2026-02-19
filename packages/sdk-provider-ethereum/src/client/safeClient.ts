import { LruMap } from '@lifi/sdk'
import type { Address, Hash } from 'viem'
import type {
  SafeInfo,
  SafeMultisigTransaction,
  SafeMultisigTransactionList,
} from './types.js'

const SAFE_CLIENT_GATEWAY = 'https://safe-client.safe.global'

// 1 hour TTL for transaction service URLs (rarely change)
const TX_SERVICE_URL_CACHE_TTL = 60 * 60 * 1_000

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

// Cache for Safe Transaction Service URLs per chain
const txServiceUrlCache = new LruMap<CacheEntry<string>>(12)

/**
 * Resolve the Safe Transaction Service URL for a given chain ID
 */
async function getTransactionServiceUrl(chainId: number): Promise<string> {
  const cached = txServiceUrlCache.get(chainId.toString())
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const response = await fetch(`${SAFE_CLIENT_GATEWAY}/v1/chains/${chainId}`)
  if (!response.ok) {
    throw new Error(
      `Failed to resolve Safe Transaction Service URL for chain ${chainId}: ${response.status}`
    )
  }

  const data = (await response.json()) as {
    transactionService: string
  }

  const url = data.transactionService
  txServiceUrlCache.set(chainId.toString(), {
    value: url,
    expiresAt: Date.now() + TX_SERVICE_URL_CACHE_TTL,
  })
  return url
}

async function request<T>(
  chainId: number,
  path: string,
  apiKey?: string
): Promise<T> {
  const baseUrl = await getTransactionServiceUrl(chainId)
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  const response = await fetch(`${baseUrl}${path}`, { headers })
  if (!response.ok) {
    throw new Error(
      `Safe Transaction Service request failed: ${response.status} ${response.statusText}`
    )
  }
  return response.json() as Promise<T>
}

export const getSafeClient = (chainId: number, apiKey?: string) => ({
  getInfo: (address: Address) =>
    request<SafeInfo>(chainId, `/api/v1/safes/${address}/`, apiKey),

  getTransaction: (safeTxHash: Hash) =>
    request<SafeMultisigTransaction>(
      chainId,
      `/api/v1/multisig-transactions/${safeTxHash}/`,
      apiKey
    ),

  getTransactions: (
    safeAddress: Address,
    options?: { executed?: boolean; limit?: number }
  ) => {
    const params = new URLSearchParams()
    if (options?.executed !== undefined) {
      params.set('executed', String(options.executed))
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit))
    }
    const qs = params.toString()
    return request<SafeMultisigTransactionList>(
      chainId,
      `/api/v1/safes/${safeAddress}/multisig-transactions/${qs ? `?${qs}` : ''}`,
      apiKey
    )
  },
})

export type SafeClient = ReturnType<typeof getSafeClient>
