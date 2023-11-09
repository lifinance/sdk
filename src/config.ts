import type { ChainId, ExtendedChain } from '@lifi/types'
import type { SDKProvider } from './core/types.js'
import type { SDKConfig, SDKOptions } from './types/index.js'

export const config = (() => {
  const _config: SDKConfig = {
    integrator: 'lifi-sdk',
    apiUrl: 'https://li.quest/v1',
    rpcUrls: {},
  }
  let _chains: ExtendedChain[]
  let _loading: Promise<void> | undefined
  return {
    get chains() {
      return _chains
    },
    set chains(chains: ExtendedChain[]) {
      _chains = chains
      _loading = undefined
    },
    set loading(loading: Promise<void>) {
      _loading = loading
    },
    async getRPCUrls() {
      if (_loading) {
        await _loading
      }
      return _config.rpcUrls
    },
    async getChainById(chainId: ChainId) {
      if (_loading) {
        await _loading
      }
      const chain = this.chains?.find((chain) => chain.id === chainId)
      if (!chain) {
        throw new Error(`ChainId ${chainId} not found`)
      }
      return chain
    },
    get() {
      return _config
    },
    set(options: SDKOptions) {
      Object.assign(_config, options)
      return _config
    },
    setProviders(providers: SDKProvider[]) {
      _config.providers = providers
    },
  }
})()
