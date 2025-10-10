import type { ChainId } from '@lifi/types'
import type { SDKProviderConfig } from './types.js'

export const getRpcUrls = async (
  config: SDKProviderConfig,
  chainId: ChainId
): Promise<string[]> => {
  const rpcUrls = (await config.getRPCUrls())[chainId]
  if (!rpcUrls?.length) {
    throw new Error(`RPC URL not found for chainId: ${chainId}`)
  }
  return rpcUrls
}
