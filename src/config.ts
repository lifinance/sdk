import {
  ChainId,
  Config,
  ConfigUpdate,
  getChainById,
  InternalExecutionSettings,
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

const DefaultExecutionSettings: InternalExecutionSettings = {
  /* eslint-disable-next-line @typescript-eslint/no-empty-function */
  updateCallback: () => {},
  switchChainHook: () => Promise.resolve(undefined),
  infiniteApproval: false,
}

export const getDefaultConfig = (): Config => {
  const defaultConfig: Config = {
    apiUrl: 'https://li.quest/v1/',
    rpcs: chainIdToObject([]),
    multicallAddresses: chainIdToObject(undefined),
    defaultExecutionSettings: DefaultExecutionSettings,
    defaultRouteOptions: {},
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

export const mergeConfig = (
  config: Config,
  configUpdate: ConfigUpdate
): Config => {
  // API
  config.apiUrl = configUpdate.apiUrl || config.apiUrl

  // RPCS
  config.rpcs = Object.assign(config.rpcs, configUpdate.rpcs)

  // MULTICALL
  config.multicallAddresses = Object.assign(
    config.multicallAddresses,
    configUpdate.multicallAddresses
  )

  // SETTINGS
  config.defaultExecutionSettings = Object.assign(
    config.defaultExecutionSettings,
    configUpdate.defaultExecutionSettings
  )

  // OPTIONS
  config.defaultRouteOptions = Object.assign(
    config.defaultRouteOptions,
    configUpdate.defaultRouteOptions
  )

  return config
}
