import type { ChainId } from '@lifi/types'
import { config } from '../config.js'

export const getRpcUrls = async (chainId: ChainId): Promise<string[]> => {
  const rpcUrls = (await config.getRPCUrls())[chainId]
  if (!rpcUrls?.length) {
    throw new Error(`RPC URL not found for chainId: ${chainId}`)
  }
  return rpcUrls
}
