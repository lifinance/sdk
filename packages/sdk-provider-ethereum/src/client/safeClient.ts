import type { Address, Client, Hash } from 'viem'
import { getCode } from 'viem/actions'
import { getAction } from 'viem/utils'
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
const txServiceUrlCache = new Map<number, CacheEntry<string>>()

// Cache for isSafeWallet results per chainId:address
const safeWalletCache = new Map<string, boolean>()

/**
 * Resolve the Safe Transaction Service URL for a given chain ID
 */
async function getTransactionServiceUrl(chainId: number): Promise<string> {
  const cached = txServiceUrlCache.get(chainId)
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
  txServiceUrlCache.set(chainId, {
    value: url,
    expiresAt: Date.now() + TX_SERVICE_URL_CACHE_TTL,
  })
  return url
}

async function safeRequest<T>(
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

export function getSafeInfo({
  chainId,
  address,
  apiKey,
}: {
  chainId: number
  address: Address
  apiKey?: string
}): Promise<SafeInfo> {
  return safeRequest<SafeInfo>(chainId, `/api/v1/safes/${address}/`, apiKey)
}

export function getSafeTransaction({
  chainId,
  safeTxHash,
  apiKey,
}: {
  chainId: number
  safeTxHash: Hash
  apiKey?: string
}): Promise<SafeMultisigTransaction> {
  return safeRequest<SafeMultisigTransaction>(
    chainId,
    `/api/v1/multisig-transactions/${safeTxHash}/`,
    apiKey
  )
}

export function getSafeTransactions({
  chainId,
  safeAddress,
  executed,
  limit,
  apiKey,
}: {
  chainId: number
  safeAddress: Address
  executed?: boolean
  limit?: number
  apiKey?: string
}): Promise<SafeMultisigTransactionList> {
  const params = new URLSearchParams()
  if (executed !== undefined) {
    params.set('executed', String(executed))
  }
  if (limit !== undefined) {
    params.set('limit', String(limit))
  }
  const qs = params.toString()
  return safeRequest<SafeMultisigTransactionList>(
    chainId,
    `/api/v1/safes/${safeAddress}/multisig-transactions/${qs ? `?${qs}` : ''}`,
    apiKey
  )
}

/**
 * Check if an address is a Safe wallet by querying the Safe Transaction Service
 */
export async function isSafeWallet(
  chainId: number,
  address: Address,
  apiKey?: string,
  client?: Client
): Promise<boolean> {
  const cacheKey = `${chainId}:${address.toLowerCase()}`
  const cached = safeWalletCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  // If a client is available, check if the address has contract code.
  // EOA wallets have no code and can never be Safe wallets.
  if (client) {
    try {
      const code = await getAction(client, getCode, 'getCode')({ address })
      if (!code || code === '0x') {
        safeWalletCache.set(cacheKey, false)
        return false
      }
    } catch {
      // If getCode fails, fall through to the Safe API check
    }
  }

  try {
    await getSafeInfo({ chainId, address, apiKey })
    safeWalletCache.set(cacheKey, true)
    return true
  } catch {
    safeWalletCache.set(cacheKey, false)
    return false
  }
}
