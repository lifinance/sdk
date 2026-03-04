import { LruMap } from '@lifi/sdk'
import type { Address, Client } from 'viem'
import { getCode } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getSafeClient } from '../client/safeClient.js'

// Cache for isSafeWallet results per chainId:address
const safeWalletCache = new LruMap<boolean>(12)

type IsSafeWalletParams = {
  chainId: number
  address: Address
  viemClient?: Client
  safeApiKey?: string
}

/**
 * Check if an address is a Safe wallet by querying the Safe Transaction Service
 */
export async function isSafeWallet({
  chainId,
  address,
  viemClient,
  safeApiKey,
}: IsSafeWalletParams): Promise<boolean> {
  const cacheKey = `${chainId}:${address.toLowerCase()}`
  const cached = safeWalletCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  // If a client is available, check if the address has contract code.
  // EOA wallets have no code and can never be Safe wallets.
  if (viemClient) {
    try {
      const code = await getAction(viemClient, getCode, 'getCode')({ address })
      if (!code || code === '0x') {
        safeWalletCache.set(cacheKey, false)
        return false
      }
    } catch {
      // If getCode fails, fall through to the Safe API check
    }
  }

  try {
    await getSafeClient(chainId, safeApiKey).getInfo(address)
    safeWalletCache.set(cacheKey, true)
    return true
  } catch {
    safeWalletCache.set(cacheKey, false)
    return false
  }
}
