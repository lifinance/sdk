import { ChainId, ChainType } from '@lifi/types'
import type { SDKProvider } from './core/types.js'
import { getChains } from './services/api.js'
import type { RPCUrls, SDKBaseConfig, SDKConfig } from './types/internal.js'
import { checkPackageUpdates } from './utils/checkPackageUpdates.js'
import { name, version } from './version.js'

function setProviders(
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

function setRPCUrls(
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

function initializeConfig(options: SDKConfig) {
  const _config: SDKBaseConfig = {
    integrator: 'lifi-sdk',
    apiUrl: 'https://li.quest/v1',
    rpcUrls: {},
    chains: [],
    providers: [],
    preloadChains: true,
    debug: false,
  }

  const { chains, providers, rpcUrls, ...otherOptions } = options
  Object.assign(_config, otherOptions)

  // Set chains
  if (chains) {
    _config.chains = chains
    const rpcUrls = chains.reduce((rpcUrls, chain) => {
      if (chain.metamask?.rpcUrls?.length) {
        rpcUrls[chain.id as ChainId] = chain.metamask.rpcUrls
      }
      return rpcUrls
    }, {} as RPCUrls)
    _config.rpcUrls = setRPCUrls(_config.rpcUrls, rpcUrls, [ChainId.SOL])
  }

  // Set providers
  if (providers) {
    _config.providers = setProviders(_config.providers, providers)
  }

  // Set RPC URLs
  if (rpcUrls) {
    _config.rpcUrls = setRPCUrls(_config.rpcUrls, rpcUrls)
  }

  return _config
}

function createBaseConfig(options: SDKConfig) {
  if (!options.integrator) {
    throw new Error(
      'Integrator not found. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
    )
  }
  const _config = initializeConfig(options)
  if (!options.disableVersionCheck && process.env.NODE_ENV === 'development') {
    checkPackageUpdates(name, version)
  }
  return _config
}

export async function createConfig(options: SDKConfig) {
  const _config = createBaseConfig(options)
  if (_config.preloadChains) {
    await getChains(_config, {
      chainTypes: [ChainType.EVM, ChainType.SVM, ChainType.UTXO, ChainType.MVM],
    })
      .then((chains) => {
        _config.chains = chains
        const rpcUrls = chains.reduce((rpcUrls, chain) => {
          if (chain.metamask?.rpcUrls?.length) {
            rpcUrls[chain.id as ChainId] = chain.metamask.rpcUrls
          }
          return rpcUrls
        }, {} as RPCUrls)
        _config.rpcUrls = setRPCUrls(_config.rpcUrls, rpcUrls, [ChainId.SOL])
      })
      .catch()
  }
  return _config
}
