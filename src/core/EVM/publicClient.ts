import { ChainId } from '@lifi/types'
import type { Client } from 'viem'
import { http, createClient, fallback, webSocket } from 'viem'
import { type Chain, mainnet } from 'viem/chains'
import { config } from '../../config.js'
import { getRpcUrls } from '../rpc.js'

// cached providers
const publicClients: Record<number, Client> = {}

/**
 * Get an instance of a provider for a specific chain
 * @param chainId - Id of the chain the provider is for
 * @returns The public client for the given chain
 */
export const getPublicClient = async (chainId: number): Promise<Client> => {
  if (!publicClients[chainId]) {
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
    publicClients[chainId] = createClient({
      chain: chain,
      transport: fallback(fallbackTransports),
      batch: {
        multicall: true,
      },
    })
  }

  if (!publicClients[chainId]) {
    throw new Error(`Unable to configure provider for chain ${chainId}`)
  }

  return publicClients[chainId]
}
