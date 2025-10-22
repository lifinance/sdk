import type { ChainId, ChainType } from '@lifi/types'
import { checkPackageUpdates } from '../../utils/checkPackageUpdates.js'
import { name, version } from '../../version.js'
import type {
  SDKBaseConfig,
  SDKClient,
  SDKConfig,
  SDKProvider,
} from '../types.js'
import { getClientStorage } from './getClientStorage.js'

export function createClient(options: SDKConfig): SDKClient {
  if (!options.integrator) {
    throw new Error(
      'Integrator not found. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
    )
  }

  if (!options.disableVersionCheck && process.env.NODE_ENV === 'development') {
    checkPackageUpdates(name, version)
  }

  const config: SDKBaseConfig = {
    ...options,
    apiUrl: options?.apiUrl ?? 'https://li.quest/v1',
    rpcUrls: options?.rpcUrls ?? {},
    debug: options?.debug ?? false,
    integrator: options?.integrator ?? 'lifi-sdk',
  }

  let _providers: SDKProvider[] = []

  const _storage = getClientStorage(config)

  return {
    config,
    providers: _providers,
    getProvider(type: ChainType) {
      return _providers.find((provider) => provider.type === type)
    },
    setProviders(newProviders: SDKProvider[]) {
      const providerMap = new Map(
        _providers.map((provider) => [provider.type, provider])
      )
      for (const provider of newProviders) {
        providerMap.set(provider.type, provider)
      }
      _providers = Array.from(providerMap.values())
    },
    async getChains() {
      return await _storage.getChains()
    },
    async getChainById(chainId: ChainId) {
      const chains = await this.getChains()
      const chain = chains?.find((chain) => chain.id === chainId)
      if (!chain) {
        throw new Error(`ChainId ${chainId} not found`)
      }
      return chain
    },
    async getRpcUrls() {
      return await _storage.getRpcUrls()
    },
    async getRpcUrlsByChainId(chainId: ChainId) {
      const rpcUrls = await this.getRpcUrls()
      const chainRpcUrls = rpcUrls[chainId]
      if (!chainRpcUrls?.length) {
        throw new Error(`RPC URL not found for chainId: ${chainId}`)
      }
      return chainRpcUrls
    },
  } as SDKClient
}
