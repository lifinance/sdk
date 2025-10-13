import type { ChainId } from '@lifi/types'
import type { SDKBaseConfig } from '../types/internal.js'

export const getRpcUrls = (
  config: SDKBaseConfig,
  chainId: ChainId
): string[] => {
  const rpcUrls = config.rpcUrls[chainId]
  if (!rpcUrls?.length) {
    throw new Error(`RPC URL not found for chainId: ${chainId}`)
  }
  return rpcUrls
}
