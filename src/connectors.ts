import { providers } from 'ethers'
import Lifi from '.'

import { ChainId } from './types'

// cached providers
const chainProviders: Record<number, providers.FallbackProvider> = {}

const getRpcUrl = (chainId: ChainId) => {
  return Lifi.getConfig().rpcs[chainId][0]
}

export const getMulticallAddress = (chainId: ChainId): string | undefined => {
  return Lifi.getConfig().multicallAddresses[chainId]
}

export const getRpcProvider = (chainId: number) => {
  if (!chainProviders[chainId]) {
    chainProviders[chainId] = new providers.FallbackProvider([
      new providers.JsonRpcProvider(getRpcUrl(chainId), chainId),
    ])
  }
  return chainProviders[chainId]
}

export const getArchiveRpcProvider = (chainId: number) => {
  if (chainId === ChainId.BSC) {
    return new providers.FallbackProvider([
      new providers.JsonRpcProvider(
        'https://speedy-nodes-nyc.moralis.io/8e02d084e88390b964f42079/bsc/mainnet/archive',
        chainId
      ),
    ])
  } else {
    return getRpcProvider(chainId)
  }
}

export const getRpcUrls = (chainIds: Array<ChainId>) => {
  const selectedProviders: Record<number, string[]> = {}
  chainIds.forEach((chainId) => {
    selectedProviders[chainId] = Lifi.getConfig().rpcs[chainId]
  })
  return selectedProviders
}
