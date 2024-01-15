import type { ChainId, ExtendedChain } from '@lifi/types'
import type { SDKProvider } from './core/types.js'
import type { SDKBaseConfig, SDKConfig } from './types/index.js'

export const config = (() => {
  const _config: SDKBaseConfig = {
    integrator: 'lifi-sdk',
    apiUrl: 'https://li.quest/v1',
    rpcUrls: {},
    chains: [],
    providers: [],
    preloadChains: true,
  }
  let _loading: Promise<void> | undefined
  return {
    set loading(loading: Promise<void>) {
      _loading = loading
    },
    get() {
      return _config
    },
    set(options: SDKConfig) {
      const { chains, providers, ...otherOptions } = options
      Object.assign(_config, otherOptions)
      if (chains) {
        this.setChains(chains)
      }
      if (providers) {
        this.setProviders(providers)
      }
      return _config
    },
    setProviders(providers: SDKProvider[]) {
      const providerMap = new Map(
        _config.providers.map((provider) => [provider.type, provider])
      )
      providers.forEach((provider) => providerMap.set(provider.type, provider))
      _config.providers = Array.from(providerMap.values())
    },
    setChains(chains: ExtendedChain[]) {
      hydrateRPCUrls(this.get(), chains)
      _config.chains = chains
      _loading = undefined
    },
    async getChains() {
      if (_loading) {
        await _loading
      }
      return _config.chains
    },
    async getChainById(chainId: ChainId) {
      if (_loading) {
        await _loading
      }
      const chain = _config.chains?.find((chain) => chain.id === chainId)
      if (!chain) {
        throw new Error(`ChainId ${chainId} not found`)
      }
      return chain
    },
    async getRPCUrls() {
      if (_loading) {
        await _loading
      }
      return _config.rpcUrls
    },
  }
})()

export const hydrateRPCUrls = (
  config: SDKBaseConfig,
  chains: ExtendedChain[]
) => {
  for (const chain of chains) {
    const chainId = chain.id as ChainId
    // set RPCs if they were not configured by the user before
    if (!config.rpcUrls[chainId]?.length) {
      config.rpcUrls[chainId] = chain.metamask.rpcUrls
    } else {
      config.rpcUrls[chainId]?.push(...chain.metamask.rpcUrls)
    }
  }
}
