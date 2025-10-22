import type { ChainId } from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { getChainsFromCache } from './getChainsFromCache.js'

export async function getRpcUrls(
  client: SDKClient,
  chainId: ChainId
): Promise<string[]> {
  // Make sure chains are up to date so we can get fresh RPC URLs
  await getChainsFromCache(client)

  const chainRpcUrls = client._storage.rpcUrls[chainId]
  if (!chainRpcUrls?.length) {
    throw new Error(`RPC URL not found for chainId: ${chainId}`)
  }
  return chainRpcUrls
}
