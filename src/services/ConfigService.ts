import {
  Chain,
  ChainId,
  Config,
  ConfigUpdate,
  InternalExecutionSettings,
} from '../types'

const DefaultExecutionSettings: InternalExecutionSettings = {
  /* eslint-disable-next-line @typescript-eslint/no-empty-function */
  updateRouteHook: () => {},
  switchChainHook: () => Promise.resolve(undefined),
  acceptExchangeRateUpdateHook: () => Promise.resolve(undefined),
  infiniteApproval: false,
  executeInBackground: false,
}

type PromiseResolver = () => void

export default class ConfigService {
  private static instance: ConfigService
  private readonly config: Config
  private readonly setupPromise: Promise<unknown>
  private resolveSetupPromise: PromiseResolver | undefined = undefined

  constructor() {
    this.config = ConfigService.getDefaultConfig()

    this.setupPromise = new Promise((resolve) => {
      this.resolveSetupPromise = resolve as PromiseResolver
    })
  }

  private static chainIdToObject<T>(val: T): Record<ChainId, T> {
    const result: Record<number, T> = {}

    const values = Object.values(ChainId)
    values.forEach((chainId) => {
      if (typeof chainId !== 'string') {
        result[chainId] = val ? JSON.parse(JSON.stringify(val)) : val
      }
    })

    return result
  }

  private static getDefaultConfig = (): Config => {
    return {
      apiUrl: 'https://li.quest/v1',
      rpcs: ConfigService.chainIdToObject([]),
      multicallAddresses: ConfigService.chainIdToObject(undefined),
      defaultExecutionSettings: DefaultExecutionSettings,
      defaultRouteOptions: {
        integrator: 'lifi-sdk',
      },
      integrator: 'lifi-sdk',
    }
  }

  public static getInstance(): ConfigService {
    if (!this.instance) {
      this.instance = new ConfigService()
    }

    return this.instance
  }

  /**
   * This call immediately returns the current config. It does not make sure that all chain data is already loaded
   * Use this if you need access to basic information like API urls or settings
   */
  public getConfig = (): Config => {
    return this.config
  }

  /**
   * This call waits for all setup promises to be done.
   * Use this if you need access to chain data (RPCs or multicalls)
   */
  public getConfigAsync = async (): Promise<Config> => {
    await this.setupPromise
    return this.config
  }

  public updateConfig = (configUpdate: Partial<ConfigUpdate>): Config => {
    // API
    this.config.apiUrl = configUpdate.apiUrl || this.config.apiUrl

    // RPCS
    this.config.rpcs = Object.assign(this.config.rpcs, configUpdate.rpcs)

    // MULTICALL
    this.config.multicallAddresses = Object.assign(
      this.config.multicallAddresses,
      configUpdate.multicallAddresses
    )

    // SETTINGS
    this.config.defaultExecutionSettings = Object.assign(
      this.config.defaultExecutionSettings,
      configUpdate.defaultExecutionSettings
    )

    // OPTIONS
    this.config.defaultRouteOptions = Object.assign(
      this.config.defaultRouteOptions,
      configUpdate.defaultRouteOptions
    )

    this.config.userId = configUpdate.userId || this.config.userId
    this.config.integrator = configUpdate.integrator || this.config.integrator
    this.config.widgetVersion =
      configUpdate.widgetVersion || this.config.widgetVersion
    this.config.multisigConfig =
      configUpdate.multisigConfig || this.config.multisigConfig

    return this.config
  }

  public updateChains = (chains: Chain[]): Config => {
    for (const chain of chains) {
      const chainId = chain.id as ChainId

      // set RPCs if they were not configured by the user before
      if (!this.config.rpcs[chainId]?.length) {
        this.config.rpcs[chainId] = chain.metamask.rpcUrls
      }

      // set multicall addresses if they exist and were not configured by the user before
      if (chain.multicallAddress && !this.config.multicallAddresses[chainId]) {
        this.config.multicallAddresses[chainId] = chain.multicallAddress
      }
    }

    this.resolveSetupPromise?.()

    return this.config
  }
}
