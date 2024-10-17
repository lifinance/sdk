import { UTXOAPIActions } from '@bigmi/core'
import type { UTXOAPISchema } from '@bigmi/core'
import { utxo } from '@bigmi/core'
import {
  type Chain,
  type Client,
  type FallbackTransport,
  type HttpTransport,
  createClient,
  fallback,
  rpcSchema,
} from 'viem'
import { config } from '../../config.js'

// cached providers
const publicAPIClients: Record<
  number,
  Client<
    FallbackTransport<readonly HttpTransport[]>,
    Chain,
    undefined,
    UTXOAPISchema,
    UTXOAPIActions
  >
> = {}

/**
 * Get an instance of a provider for a specific chain
 * @param chainId - Id of the chain the provider is for
 * @returns The public client for the given chain
 */
export const getUTXOAPIPublicClient = async (chainId: number) => {
  if (!publicAPIClients[chainId]) {
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
    const client = createClient({
      chain,
      rpcSchema: rpcSchema<UTXOAPISchema>(),
      transport: fallback([
        utxo('https://api.blockchair.com', {
          key: 'blockchair',
          includeChainToURL: true,
        }),
        utxo('https://rpc.ankr.com/http/btc_blockbook/api/v2', {
          key: 'ankr',
        }),
        utxo('https://api.blockcypher.com/v1/btc/main', {
          key: 'blockcypher',
        }),
        utxo('https://mempool.space/api', {
          key: 'mempool',
        }),
      ]),
    }).extend(UTXOAPIActions)
    publicAPIClients[chainId] = client
  }

  if (!publicAPIClients[chainId]) {
    throw new Error(`Unable to configure provider for chain ${chainId}`)
  }

  return publicAPIClients[chainId]
}
