import type { ChainId, ChainType, ExtendedChain } from '@lifi/types'
import type {
  RPCUrls,
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

  const { providers, rpcUrls, ...configOptions } = options

  // Role entries split once, here: the config keeps plain read lists, so
  // everything that reads `config.rpcUrls` sees `string[]` as before.
  const readRpcUrls: RPCUrls = {}
  const writeRpcUrls: RPCUrls = {}
  for (const key in rpcUrls) {
    const chainId = Number(key) as ChainId
    const entry = rpcUrls[chainId]
    if (Array.isArray(entry)) {
      readRpcUrls[chainId] = entry
    } else if (entry) {
      if (entry.read) {
        readRpcUrls[chainId] = entry.read
      }
      if (entry.write?.length) {
        writeRpcUrls[chainId] = entry.write
      }
    }
  }

  const _config: SDKBaseConfig = {
    ...configOptions,
    apiUrl: configOptions?.apiUrl ?? 'https://li.quest/v1',
    rpcUrls: readRpcUrls,
    debug: configOptions?.debug ?? false,
    preloadChains: configOptions?.preloadChains ?? true,
    integrator: configOptions?.integrator ?? 'lifi-sdk',
  }

  let _providers: SDKProvider[] = providers ?? []
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
    async getWriteRpcUrlsByChainId(chainId: ChainId) {
      return writeRpcUrls[chainId] ?? []
    },
  }

  function extend<TClient extends SDKClient>(
    base: TClient
  ): <TExtensions extends Record<string, any>>(
    extendFn: (client: TClient) => TExtensions
  ) => TClient & TExtensions {
    return (extendFn) => {
      const extensions = extendFn(base)
      // Copy descriptors rather than spreading. `config` and `providers` are
      // accessors over closure variables, and `setProviders` reassigns
      // `_providers` — so a spread would freeze the extension on the values
      // those getters happened to return at extend time, leaving it with a
      // provider list that never updates.
      const extended = Object.defineProperties(
        {},
        {
          ...Object.getOwnPropertyDescriptors(base),
          ...Object.getOwnPropertyDescriptors(extensions),
        }
      ) as TClient & typeof extensions

      // Preserve the extend function for further extensions
      return Object.assign(extended, {
        extend: extend(extended),
      })
    }
  }

  return Object.assign(client, { extend: extend(client) })
}
