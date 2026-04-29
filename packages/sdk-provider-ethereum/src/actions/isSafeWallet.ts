import { LruMap, type SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { getSafeClient } from '../client/safeClient.js'
import { getAccountCode } from './getAccountCode.js'
import { isSmartContractWalletCode } from './isSmartContractWallet.js'

// Caches the Safe Transaction Service verdict (network round trip). The
// underlying `eth_getCode` is intentionally uncached — see `getAccountCode`.
const safeWalletCache = new LruMap<boolean>(12)

type IsSafeWalletParams = {
  client: SDKClient
  chainId: number
  address: Address
  safeApiKey?: string
}

/**
 * Check if an address is a Safe wallet via the Safe Transaction Service,
 * short-circuiting on `eth_getCode` for EOAs (incl. EIP-7702 delegated).
 */
export async function isSafeWallet({
  client,
  chainId,
  address,
  safeApiKey,
}: IsSafeWalletParams): Promise<boolean> {
  const cacheKey = `${chainId}:${address.toLowerCase()}`
  const cached = safeWalletCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  // RPC failure → `code === undefined` → treat as not-a-Safe (conservative,
  // also avoids a Safe API hit on a flaky chain).
  const code = await getAccountCode({ client, chainId, address })
  if (!isSmartContractWalletCode(code)) {
    safeWalletCache.set(cacheKey, false)
    return false
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
