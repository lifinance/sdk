import { ChainId, ChainType } from '@lifi/types'
import {
  getMergedProviders,
  getMergedRPCUrls,
  getMetamaskRPCUrls,
} from './core/configProvider.js'
import type { SDKBaseConfig, SDKConfig } from './core/types.js'
import { getChains } from './services/api.js'
import { checkPackageUpdates } from './utils/checkPackageUpdates.js'
import { name, version } from './version.js'

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
    const rpcUrls = getMetamaskRPCUrls(chains)
    _config.rpcUrls = getMergedRPCUrls(_config.rpcUrls, rpcUrls, [ChainId.SOL])
  }

  // Set providers
  if (providers) {
    _config.providers = getMergedProviders(_config.providers, providers)
  }

  // Set RPC URLs
  if (rpcUrls) {
    _config.rpcUrls = getMergedRPCUrls(_config.rpcUrls, rpcUrls)
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
        // Set chains
        _config.chains = chains
        const rpcUrls = getMetamaskRPCUrls(chains)
        _config.rpcUrls = getMergedRPCUrls(_config.rpcUrls, rpcUrls, [
          ChainId.SOL,
        ])
      })
      .catch()
  }
  return _config
}
