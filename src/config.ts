import {
  ChainId,
  Config,
  ConfigUpdate,
  getChainById,
  multicallAddresses,
} from './types'

function chainIdToObject<T>(val: T): Record<ChainId, T> {
  const result: Record<number, T> = {}

  const values = Object.values(ChainId)
  values.forEach((chainId) => {
    if (typeof chainId !== 'string') {
      result[chainId] = val ? JSON.parse(JSON.stringify(val)) : val
    }
  })

  return result
}

export const getDefaultConfig = (): Config => {
  const defaultConfig: Config = {
    apiUrl: 'https://li.finance/api/',
    rpcs: chainIdToObject([]),
    multicallAddresses: chainIdToObject(undefined),
  }

  // RPCS
  for (const chainIdStr of Object.keys(defaultConfig.rpcs)) {
    const chainId = parseInt(chainIdStr) as ChainId
    const chain = getChainById(chainId)
    defaultConfig.rpcs[chainId] = chain.metamask.rpcUrls
  }

  // MULTICALL
  for (const chainIdStr of Object.keys(defaultConfig.multicallAddresses)) {
    const chainId = parseInt(chainIdStr) as ChainId
    if (multicallAddresses[chainId]) {
      defaultConfig.multicallAddresses[chainId] = multicallAddresses[chainId]
    }
  }

  return defaultConfig
}

export const mergeConfig = (config: Config, configUpdate: ConfigUpdate) => {
  config.apiUrl = configUpdate.apiUrl || config.apiUrl
  config.rpcs = Object.assign(config.rpcs, configUpdate.rpcs)
  config.multicallAddresses = Object.assign(
    config.multicallAddresses,
    configUpdate.multicallAddresses
  )
  return config
}
