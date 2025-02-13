import { ChainId, type ChainType, type ExtendedChain } from '@lifi/types'
import type { SDKProvider } from './core/types.js'
import type { RPCUrls, SDKBaseConfig, SDKConfig } from './types/internal.js'

export const config = (() => {
  const _config: SDKBaseConfig = {
    integrator: 'lifi-sdk',
    apiUrl: 'https://li.quest/v1',
    rpcUrls: {},
    chains: [],
    providers: [],
    preloadChains: true,
    debug: false,
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
      const { chains, providers, rpcUrls, ...otherOptions } = options
      Object.assign(_config, otherOptions)
      if (chains) {
        this.setChains(chains)
      }
      if (providers) {
        this.setProviders(providers)
      }
      if (rpcUrls) {
        this.setRPCUrls(rpcUrls)
      }
      return _config
    },
    getProvider(type: ChainType) {
      return _config.providers.find((provider) => provider.type === type)
    },
    setProviders(providers: SDKProvider[]) {
      const providerMap = new Map(
        _config.providers.map((provider) => [provider.type, provider])
      )
      for (const provider of providers) {
        providerMap.set(provider.type, provider)
      }
      _config.providers = Array.from(providerMap.values())
    },
    setChains(chains: ExtendedChain[]) {
      const rpcUrls = chains.reduce((rpcUrls, chain) => {
        if (chain.metamask?.rpcUrls?.length) {
          rpcUrls[chain.id as ChainId] = chain.metamask.rpcUrls
        }
        return rpcUrls
      }, {} as RPCUrls)
      this.setRPCUrls(rpcUrls, [ChainId.SOL])
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
    setRPCUrls(rpcUrls: RPCUrls, skipChains?: ChainId[]) {
      for (const rpcUrlsKey in rpcUrls) {
        const chainId = Number(rpcUrlsKey) as ChainId
        const urls = rpcUrls[chainId]
        if (!urls?.length) {
          continue
        }
        if (!_config.rpcUrls[chainId]?.length) {
          _config.rpcUrls[chainId] = Array.from(urls)
        } else if (!skipChains?.includes(chainId)) {
          const filteredUrls = urls.filter(
            (url) => !_config.rpcUrls[chainId]?.includes(url)
          )
          _config.rpcUrls[chainId].push(...filteredUrls)
        }
      }
    },
    async getRPCUrls() {
      if (_loading) {
        await _loading
      }
      return _config.rpcUrls
    },
  }
})()
