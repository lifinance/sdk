import type { ChainId } from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { getChainsFromCache } from './getChainsFromCache.js'

export async function getChainById(client: SDKClient, chainId: ChainId) {
  const chains = await getChainsFromCache(client)
  const chain = chains?.find((chain) => chain.id === chainId)
  if (!chain) {
    throw new Error(`ChainId ${chainId} not found`)
  }
  return chain
}
