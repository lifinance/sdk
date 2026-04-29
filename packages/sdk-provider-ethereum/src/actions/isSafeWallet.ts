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
  if (!address) {
    return false
  }
  const cacheKey = `${chainId}:${address.toLowerCase()}`
  const cached = safeWalletCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  // Defined-and-EOA-shaped (`'0x'` or 7702 designator) → short-circuit. RPC
  // failure (`code === undefined`) falls through to the Safe API as an
  // independent fallback — Safe Transaction Service doesn't depend on the
  // chain RPC, so a flaky chain shouldn't blind us to a real Safe.
  const code = await getAccountCode({ client, chainId, address })
  if (code !== undefined && !isSmartContractWalletCode(code)) {
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
