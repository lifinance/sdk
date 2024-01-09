/* eslint-disable @typescript-eslint/no-empty-function */
import { ChainType } from '@lifi/types'
import { config } from './config.js'
import { checkPackageUpdates } from './helpers.js'
import { getChains } from './services/api.js'
import type { SDKConfig } from './types/index.js'
import { name, version } from './version.js'

function createBaseConfig(options: SDKConfig) {
  if (!options.integrator) {
    throw new Error(
      'Integrator not found. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
    )
  }
  const _config = config.set(options)
  checkPackageUpdates(name, version, options.disableVersionCheck)
  return _config
}

export async function createChainsConfig() {
  config.loading = getChains({ chainTypes: Object.values(ChainType) })
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
