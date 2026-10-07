import { ChainId, ChainType, type SDKClient } from '@lifi/sdk'
import type { Client } from 'viem'
import { type Address, createClient, fallback, http, webSocket } from 'viem'
import { type Chain, mainnet } from 'viem/chains'
import { UNS_PROXY_READER_ADDRESSES } from '../actions/constants.js'
import type { EthereumSDKProvider } from '../types.js'

// One client per chain. The cache holds the build promise, not the client,
// so concurrent first calls share one build: each extra client would keep
// its own fallback ranking loop running.
const publicClients = new Map<number, Promise<Client>>()

/**
 * Get an instance of a provider for a specific chain
 * @param client - The SDK client
 * @param chainId - Id of the chain the provider is for
 * @returns The public client for the given chain
 */
export const getPublicClient = (
  client: SDKClient,
  chainId: number
): Promise<Client> => {
  let publicClient = publicClients.get(chainId)
  if (!publicClient) {
    // A failed build is removed, so the next call builds again.
    publicClient = buildPublicClient(client, chainId).catch((error) => {
      publicClients.delete(chainId)
      throw error
    })
    publicClients.set(chainId, publicClient)
  }
  return publicClient
}

const buildPublicClient = async (
  client: SDKClient,
  chainId: number
): Promise<Client> => {
  const urls = await client.getRpcUrlsByChainId(chainId)
  const fallbackTransports = urls.map((url) =>
    url.startsWith('wss')
      ? webSocket(url)
      : http(url, {
          batch: {
            batchSize: 64,
          },
        })
  )
  const _chain = await client.getChainById(chainId)
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

  const provider = client.getProvider(ChainType.EVM) as
    | EthereumSDKProvider
    | undefined
  return createClient({
    chain: chain,
    transport: fallback(
      fallbackTransports,
      provider?.options?.fallbackTransportConfig
    ),
    batch: {
      multicall: true,
    },
  })
}
