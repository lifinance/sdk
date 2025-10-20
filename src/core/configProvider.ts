import type { ChainId, ExtendedChain } from '@lifi/types'
import { ChainType } from '@lifi/types'
import { getChains } from '../services/api.js'
import type { RPCUrls, SDKBaseConfig, SDKProvider } from './types.js'

export function getProvider(
  config: SDKBaseConfig,
  type: ChainType
): SDKProvider | undefined {
  return config.providers.find(
    (provider: SDKProvider) => provider.type === type
  )
}

export async function getChainById(config: SDKBaseConfig, chainId: ChainId) {
  const chains = await getChains(config, {
    chainTypes: [ChainType.EVM, ChainType.SVM, ChainType.UTXO, ChainType.MVM],
  })
  const chain = chains?.find((chain) => chain.id === chainId)
  if (!chain) {
    throw new Error(`ChainId ${chainId} not found`)
  }
  return chain
}

export function getMergedRPCUrls(
  configRPCUrls: RPCUrls,
  rpcUrls: RPCUrls,
  skipChains?: ChainId[]
) {
  const newRPCUrls = { ...configRPCUrls }
  for (const rpcUrlsKey in rpcUrls) {
    const chainId = Number(rpcUrlsKey) as ChainId
    const urls = rpcUrls[chainId]
    if (!urls?.length) {
      continue
    }
    if (!newRPCUrls[chainId]?.length) {
      newRPCUrls[chainId] = Array.from(urls)
    } else if (!skipChains?.includes(chainId)) {
      const filteredUrls = urls.filter(
        (url) => !newRPCUrls[chainId]?.includes(url)
      )
      newRPCUrls[chainId].push(...filteredUrls)
    }
  }

  return newRPCUrls
}

export function getMetamaskRPCUrls(chains: ExtendedChain[]) {
  return chains.reduce((rpcUrls, chain) => {
    if (chain.metamask?.rpcUrls?.length) {
      rpcUrls[chain.id as ChainId] = chain.metamask.rpcUrls
    }
    return rpcUrls
  }, {} as RPCUrls)
}
