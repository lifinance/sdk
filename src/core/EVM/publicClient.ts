import type { PublicClient } from 'viem'
import { createPublicClient, fallback, http } from 'viem'
import type { Chain } from 'viem/chains'
import { config } from '../../config.js'
import { getRpcUrls } from '../utils.js'

// cached providers
const publicClients: Record<number, PublicClient> = {}

/**
 * Get an instance of a provider for a specific chain
 * @param chainId - Id of the chain the provider is for
 * @returns The public client for the given chain
 */
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
    publicClients[chainId] = createPublicClient({
      chain: chain,
      transport: fallback(fallbackTransports),
    })
  }

  if (!publicClients[chainId]) {
    throw new Error(`Unable to configure provider for chain ${chainId}`)
  }

  return publicClients[chainId]
}
