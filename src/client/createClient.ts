import { ChainId, type ChainType, type ExtendedChain } from '@lifi/types'
import type {
  RPCUrls,
  SDKBaseConfig,
  SDKClient,
  SDKConfig,
  SDKProvider,
} from '../core/types.js'
import { checkPackageUpdates } from '../utils/checkPackageUpdates.js'
import { name, version } from '../version.js'

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
  let _chains: ExtendedChain[] = []
  const _rpcUrls: RPCUrls = { ...config.rpcUrls }

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
    // Config cache
    _storage: {
      chainsUpdatedAt: undefined,
      chains: _chains,
      rpcUrls: _rpcUrls,
      setChains(chains: ExtendedChain[]) {
        const rpcUrls = chains.reduce((rpcUrls, chain) => {
          if (chain.metamask?.rpcUrls?.length) {
            _rpcUrls[chain.id as ChainId] = chain.metamask.rpcUrls
          }
          return rpcUrls
        }, {} as RPCUrls)
        this.setRPCUrls(rpcUrls, [ChainId.SOL])
        _chains = chains
      },
      setRPCUrls(rpcUrls: RPCUrls, skipChains?: ChainId[]) {
        for (const rpcUrlsKey in rpcUrls) {
          const chainId = Number(rpcUrlsKey) as ChainId
          const urls = rpcUrls[chainId]
          if (!urls?.length) {
            continue
          }
          if (!_rpcUrls[chainId]?.length) {
            _rpcUrls[chainId] = Array.from(urls)
          } else if (!skipChains?.includes(chainId)) {
            const filteredUrls = urls.filter(
              (url) => !_rpcUrls[chainId]?.includes(url)
            )
            _rpcUrls[chainId].push(...filteredUrls)
          }
        }
      },
    },
  } as SDKClient
}
