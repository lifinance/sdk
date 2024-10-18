import type { ChainId } from '@lifi/types'
import { config } from '../config.js'

export const getRpcUrl = async (chainId: ChainId): Promise<string> => {
  const rpcUrls = await getRpcUrls(chainId)
  return rpcUrls[0]
}

export const getRpcUrls = async (chainId: ChainId): Promise<string[]> => {
  const rpcUrls = (await config.getRPCUrls())[chainId]
  if (!rpcUrls?.length) {
    throw new Error('RPC URL not found')
  }
  return rpcUrls
}
