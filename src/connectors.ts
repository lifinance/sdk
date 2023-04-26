import {
  FallbackProvider,
  StaticJsonRpcProvider,
} from '@ethersproject/providers'
import { getRandomNumber } from './helpers'
import ConfigService from './services/ConfigService'
import { ChainId } from './types'
import { ServerError } from './utils/errors'

// cached providers
const chainProviders: Record<number, FallbackProvider[]> = {}

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
export const getRpcUrl = async (
  chainId: ChainId,
  archive = false
): Promise<string> => {
  const rpcUrls = await getRpcUrls(chainId, archive)
  return rpcUrls[0]
}

export const getRpcUrls = async (
  chainId: ChainId,
  archive = false
): Promise<string[]> => {
  if (archive && archiveRpcs[chainId]) {
    return [archiveRpcs[chainId]]
  }

  const configService = ConfigService.getInstance()
  const config = await configService.getConfigAsync()
  return config.rpcs[chainId]
}

const getRandomProvider = (
  providerList: FallbackProvider[]
): FallbackProvider => {
  const index = getRandomNumber(0, providerList.length - 1)
  return providerList[index]
}

// Provider
export const getRpcProvider = async (
  chainId: number,
  archive = false
): Promise<FallbackProvider> => {
  if (archive && archiveRpcs[chainId]) {
    // return archive PRC, but don't cache it
    return new FallbackProvider([
      new StaticJsonRpcProvider(await getRpcUrl(chainId, archive), chainId),
    ])
  }

  if (!chainProviders[chainId]?.length) {
    chainProviders[chainId] = []

    const urls = await getRpcUrls(chainId, archive)
    urls.forEach((url) => {
      chainProviders[chainId].push(
        new FallbackProvider([new StaticJsonRpcProvider(url, chainId)])
      )
    })
  }

  if (!chainProviders[chainId].length) {
    throw new ServerError(`Unable to configure provider for chain ${chainId}`)
  }

  return getRandomProvider(chainProviders[chainId])
}

// Multicall
export const getMulticallAddress = async (
  chainId: ChainId
): Promise<string | undefined> => {
  const configService = ConfigService.getInstance()
  const config = await configService.getConfigAsync()
  return config.multicallAddresses[chainId]
}
