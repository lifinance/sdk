import type { ChainId, ChainType, ExtendedChain } from '@lifi/types'
import type {
  SDKBaseConfig,
  SDKClient,
  SDKConfig,
  SDKProvider,
} from '../types/core.js'
import { checkPackageUpdates } from '../utils/checkPackageUpdates.js'
import { name, version } from '../version.js'
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

  const _config: SDKBaseConfig = {
    ...options,
    apiUrl: options?.apiUrl ?? 'https://li.quest/v1',
    rpcUrls: options?.rpcUrls ?? {},
    debug: options?.debug ?? false,
    integrator: options?.integrator ?? 'lifi-sdk',
  }

  let _providers: SDKProvider[] = []
  const _storage = getClientStorage(_config)

  const client: SDKClient = {
    get config() {
      return _config
    },
    get providers() {
      return _providers
    },
    getProvider(type: ChainType) {
      return this.providers.find((provider) => provider.type === type)
    },
    setProviders(newProviders: SDKProvider[]) {
      const providerMap = new Map(
        this.providers.map((provider) => [provider.type, provider])
      )
      for (const provider of newProviders) {
        providerMap.set(provider.type, provider)
      }
      _providers = Array.from(providerMap.values())
    },
    setChains(chains: ExtendedChain[]) {
      _storage.setChains(chains)
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
  }

  function extend<TClient extends SDKClient>(
    base: TClient
  ): <TExtensions extends Record<string, any>>(
    extendFn: (client: TClient) => TExtensions
  ) => TClient & TExtensions {
    return (extendFn) => {
      const extensions = extendFn(base)
      const extended = { ...base, ...extensions } as TClient & typeof extensions

      // Preserve the extend function for further extensions
      return Object.assign(extended, {
        extend: extend(extended),
      })
    }
  }

  return Object.assign(client, { extend: extend(client) })
}
