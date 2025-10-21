import type { SDKBaseConfig, SDKConfig } from './core/types.js'
import { checkPackageUpdates } from './utils/checkPackageUpdates.js'
import { name, version } from './version.js'

function initializeConfig(options: SDKConfig) {
  const _config: SDKBaseConfig = {
    integrator: 'lifi-sdk',
    apiUrl: 'https://li.quest/v1',
    rpcUrls: {},
    debug: false,
  }
  Object.assign(_config, options)
  return _config
}

export function createConfig(options: SDKConfig) {
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
