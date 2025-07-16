import { ChainId, ChainType } from '@lifi/types'
import type { Client } from 'viem'
import { type Address, createClient, fallback, http, webSocket } from 'viem'
import { type Chain, mainnet } from 'viem/chains'
import { config } from '../../config.js'
import { getRpcUrls } from '../rpc.js'
import type { EVMProvider } from './types.js'
import { UNS_PROXY_READER_ADDRESSES } from './uns/constants.js'

// cached providers
const publicClients: Record<number, Client> = {}

/**
 * Get an instance of a provider for a specific chain
 * @param chainId - Id of the chain the provider is for
 * @returns The public client for the given chain
 */
export const getPublicClient = async (chainId: number): Promise<Client> => {
  if (publicClients[chainId]) {
    return publicClients[chainId]
  }

  const urls = await getRpcUrls(chainId)
  const fallbackTransports = urls.map((url) =>
    url.startsWith('wss')
      ? webSocket(url)
      : http(url, {
          batch: {
            batchSize: 64,
          },
        })
  )
  const _chain = await config.getChainById(chainId)
  const chain: Chain = {
    ..._chain,
    ..._chain.metamask,
    name: _chain.metamask.chainName,
    rpcUrls: {
      default: { http: _chain.metamask.rpcUrls },
      public: { http: _chain.metamask.rpcUrls },
    },
  }
  // Add ENS contracts
  if (chain.id === ChainId.ETH) {
    chain.contracts = {
      ...mainnet.contracts,
      ...chain.contracts,
    }
  }

  // Add UNS contracts for supported chains
  if (chain.id === ChainId.ETH || chain.id === ChainId.POL) {
    const unsProxyAddress = UNS_PROXY_READER_ADDRESSES[chain.id]

    chain.contracts = {
      ...chain.contracts,
      unsProxyReader: { address: unsProxyAddress as Address },
    }
  }

  const provider = config.getProvider(ChainType.EVM) as EVMProvider | undefined
  publicClients[chainId] = createClient({
    chain: chain,
    transport: fallback(
      fallbackTransports,
      provider?.options?.fallbackTransportConfig
    ),
    batch: {
      multicall: true,
    },
  })

  return publicClients[chainId]
}
