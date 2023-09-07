import type { ChainId } from '@lifi/types'
import type { PublicClient } from 'viem'
import { createPublicClient, fallback, http } from 'viem'
import type { Chain } from 'viem/chains' // TODO: optimize using BE chains
import * as chains from 'viem/chains' // TODO: optimize using BE chains
import { ConfigService } from './services/ConfigService.js'
import { ServerError } from './utils/errors.js'

// cached providers
const publicClients: Record<number, PublicClient> = {}

export const getChainById = (chainId: ChainId): Chain | undefined => {
  return Object.values(chains).find((chain) => chain.id === chainId)
}

// RPC Urls
export const getRpcUrl = async (chainId: ChainId): Promise<string> => {
  const rpcUrls = await getRpcUrls(chainId)
  return rpcUrls[0]
}

export const getRpcUrls = async (chainId: ChainId): Promise<string[]> => {
  const configService = ConfigService.getInstance()
  const config = await configService.getConfigAsync()
  return config.rpcs[chainId]
}

export const getPublicClient = async (
  chainId: number
): Promise<PublicClient> => {
  if (!publicClients[chainId]) {
    const urls = await getRpcUrls(chainId)
    const fallbackTransports = urls.map((url) =>
      http(url, {
        batch: true,
      })
    )

    publicClients[chainId] = createPublicClient({
      chain: getChainById(chainId),
      transport: fallback(fallbackTransports),
    })
  }

  if (!publicClients[chainId]) {
    throw new ServerError(`Unable to configure provider for chain ${chainId}`)
  }

  return publicClients[chainId]
}

// Multicall
export const getMulticallAddress = async (
  chainId: ChainId
): Promise<string | undefined> => {
  const configService = ConfigService.getInstance()
  const config = await configService.getConfigAsync()
  return config.multicallAddresses[chainId]
}
