import { providers } from 'ethers'
import Lifi, { getRandomNumber } from '.'

import { ChainId } from './types'
import { FallbackProvider } from '@ethersproject/providers'

// cached providers
const chainProviders: Record<number, providers.FallbackProvider[]> = {}

// Archive RPC Provider
const archiveRpcs: Record<number, string> = {
  [ChainId.ETH]:
    'https://speedy-nodes-nyc.moralis.io/5ed6053dc39eba789ff466c9/eth/mainnet/archive',
  [ChainId.BSC]:
    'https://speedy-nodes-nyc.moralis.io/5ed6053dc39eba789ff466c9/bsc/mainnet/archive',
  [ChainId.POL]:
    'https://speedy-nodes-nyc.moralis.io/5ed6053dc39eba789ff466c9/polygon/mainnet/archive',
  [ChainId.FTM]:
    'https://speedy-nodes-nyc.moralis.io/5ed6053dc39eba789ff466c9/fantom/mainnet',
}

// RPC Urls
export const getRpcUrl = (chainId: ChainId, archive = false): string => {
  return getRpcUrls(chainId, archive)[0]
}

export const getRpcUrls = (chainId: ChainId, archive = false): string[] => {
  if (archive && archiveRpcs[chainId]) {
    return [archiveRpcs[chainId]]
  }

  return Lifi.getConfig().rpcs[chainId]
}

const getRandomProvider = (
  providerList: providers.FallbackProvider[]
): providers.FallbackProvider => {
  const index = getRandomNumber(0, providerList.length - 1)
  return providerList[index]
}

// Provider
export const getRpcProvider = (
  chainId: number,
  archive = false
): FallbackProvider => {
  if (archive && archiveRpcs[chainId]) {
    // return archive PRC, but don't cache it
    return new providers.FallbackProvider([
      new providers.StaticJsonRpcProvider(getRpcUrl(chainId, archive), chainId),
    ])
  }

  if (!chainProviders[chainId]) {
    chainProviders[chainId] = []

    const urls = getRpcUrls(chainId, archive)
    urls.forEach((url) => {
      chainProviders[chainId].push(
        new providers.FallbackProvider([
          new providers.StaticJsonRpcProvider(url, chainId),
        ])
      )
    })
  }

  return getRandomProvider(chainProviders[chainId])
}

// Multicall
export const getMulticallAddress = (chainId: ChainId): string | undefined => {
  return Lifi.getConfig().multicallAddresses[chainId]
}
