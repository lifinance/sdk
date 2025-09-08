import { ChainType } from '@lifi/types'
import { config } from './config.js'
import { getChains } from './services/api.js'
import type { SDKConfig } from './types/internal.js'
import { checkPackageUpdates } from './utils/checkPackageUpdates.js'
import { name, version } from './version.js'

function createBaseConfig(options: SDKConfig) {
  if (!options.integrator) {
    throw new Error(
      'Integrator not found. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
    )
  }
  const _config = config.set(options)
  if (!options.disableVersionCheck && process.env.NODE_ENV === 'development') {
    checkPackageUpdates(name, version)
  }
  return _config
}

async function createChainsConfig() {
  config.loading = getChains({
    chainTypes: [ChainType.EVM, ChainType.SVM, ChainType.UTXO, ChainType.MVM],
  })
    .then((chains) => config.setChains(chains))
    .catch()
  await config.loading
}

export function createConfig(options: SDKConfig) {
  const _config = createBaseConfig(options)
  if (_config.preloadChains) {
    createChainsConfig()
  }
  return _config
}
