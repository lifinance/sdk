/* eslint-disable @typescript-eslint/no-empty-function */
import type { ChainId } from '@lifi/types'
import { config } from './config.js'
import { isEVM } from './core/EVM/types.js'
import { checkPackageUpdates } from './helpers.js'
import { getChains } from './services/api.js'
import type { SDKOptions } from './types/index.js'
import { name, version } from './version.js'

function createBaseConfig(options: SDKOptions) {
  if (!options.integrator) {
    throw new Error(
      'Integrator not found. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
    )
  }
  config.set(options)
  checkPackageUpdates(name, version, options.disableVersionCheck)
}

export async function createChainsConfig() {
  const _config = config.get()
  const chainTypes = _config.providers?.map((provider) => provider.type)
  config.loading = getChains({ chainTypes: chainTypes })
    .then((chains) => {
      config.chains = chains
      const evmProvider = _config.providers?.find(isEVM)
      const multicallAddresses: Partial<Record<ChainId, string>> = {}
      for (const chain of chains) {
        const chainId = chain.id as ChainId

        // set RPCs if they were not configured by the user before
        if (!_config.rpcUrls[chainId]?.length) {
          _config.rpcUrls[chainId] = chain.metamask.rpcUrls
        }

        // set multicall addresses if they exist and were not configured by the user before
        if (chain.multicallAddress && !evmProvider?.multicall?.[chainId]) {
          multicallAddresses[chainId] = chain.multicallAddress
        }
      }
      evmProvider?.setOptions({
        multicall: multicallAddresses,
      })
    })
    .catch()
  await config.loading
}

export function createConfig(options: SDKOptions) {
  createBaseConfig(options)
  createChainsConfig()
  return {
    set: config.set,
    get: config.get,
  }
}
