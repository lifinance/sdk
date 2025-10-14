import type { ChainId, ChainType, ExtendedChain } from '@lifi/types'
import type { RPCUrls, SDKBaseConfig, SDKProvider } from './types.js'

export function getProvider(
  config: SDKBaseConfig,
  type: ChainType
): SDKProvider | undefined {
  return config.providers.find(
    (provider: SDKProvider) => provider.type === type
  )
}

export function getMergedProviders(
  configProviders: SDKProvider[],
  providers: SDKProvider[]
) {
  const providerMap = new Map(
    configProviders.map((provider) => [provider.type, provider])
  )
  for (const provider of providers) {
    providerMap.set(provider.type, provider)
  }
  return Array.from(providerMap.values())
}

export function getChainById(config: SDKBaseConfig, chainId: ChainId) {
  const chain = config.chains?.find((chain) => chain.id === chainId)
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
