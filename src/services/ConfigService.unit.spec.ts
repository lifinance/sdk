import { beforeEach, describe, expect, it } from 'vitest'
import { ChainId, supportedChains } from '../types'
import type ChainsService from './ChainsService'
import ConfigService from './ConfigService'

let configService: ConfigService
let chainsService: ChainsService

describe('ConfigService', () => {
  beforeEach(() => {
    configService = ConfigService.getInstance()
  })

  describe('getConfig', () => {
    it('should return the default config', () => {
      const defaultConfig = configService.getConfig()

      expect(defaultConfig.apiUrl).toEqual('https://li.quest/v1')
      expect(defaultConfig.defaultRouteOptions).toEqual({
        integrator: 'lifi-sdk',
      })
      expect(defaultConfig.rpcs).toBeDefined()
      expect(defaultConfig.multicallAddresses).toBeDefined()
      expect(
        defaultConfig.defaultExecutionSettings.updateRouteHook
      ).toBeDefined()
      expect(
        defaultConfig.defaultExecutionSettings.switchChainHook
      ).toBeDefined()
    })
  })

  describe('updateConfig', () => {
    it('should return a if b is empty', () => {
      const configA = configService.getConfig()
      const configB = {}
      const mergedConfig = configService.updateConfig(configB)

      expect(mergedConfig).toEqual(configA)
    })

    it('should overwrite the api url if set', () => {
      const configB = {
        apiUrl: 'some other api url',
      }
      const mergedConfig = configService.updateConfig(configB)

      expect(mergedConfig.apiUrl).toEqual(configB.apiUrl)
    })

    it('should merge the default route options', () => {
      const configA = configService.getConfig()
      configA.defaultRouteOptions = {
        infiniteApproval: true,
        slippage: 0.3,
      }
      const configB = {
        defaultRouteOptions: {
          slippage: 0,
          integrator: 'new-integrator',
        },
      }
      const mergedConfig = configService.updateConfig(configB)

      expect(mergedConfig.defaultRouteOptions.infiniteApproval).toEqual(
        configA.defaultRouteOptions.infiniteApproval
      )
      expect(mergedConfig.defaultRouteOptions.slippage).toEqual(
        configB.defaultRouteOptions.slippage
      )
      expect(mergedConfig.defaultRouteOptions.integrator).toEqual(
        configB.defaultRouteOptions.integrator
      )
    })

    it('should merge the default execution settings', () => {
      const configA = configService.getConfig()
      const configB = {
        defaultExecutionSettings: {
          updateRouteHook: () => 'something else',
        },
      }
      const mergedConfig = configService.updateConfig(configB)

      expect(mergedConfig.defaultExecutionSettings.switchChainHook).toEqual(
        configA.defaultExecutionSettings.switchChainHook
      )
      expect(mergedConfig.defaultExecutionSettings.updateRouteHook).toEqual(
        configB.defaultExecutionSettings.updateRouteHook
      )
    })

    it('should overwrite rpcs for the passed chains and leave the others untouched', () => {
      const configA = configService.getConfig()
      const configB = {
        rpcs: {
          [ChainId.ETH]: ['some other rpc'],
        },
      }
      const mergedConfig = configService.updateConfig(configB)

      expect(mergedConfig.rpcs[ChainId.BSC]).toEqual(configA.rpcs[ChainId.BSC])
      expect(mergedConfig.rpcs[ChainId.ETH]).toEqual(configB.rpcs[ChainId.ETH])
    })

    it('should overwrite multicallAddresses for the passed chains and leave the others untouched', () => {
      const configA = configService.getConfig()
      const configB = {
        multicallAddresses: {
          [ChainId.ETH]: 'some other multicallAddress',
        },
      }
      const mergedConfig = configService.updateConfig(configB)

      expect(mergedConfig.multicallAddresses[ChainId.BSC]).toEqual(
        configA.multicallAddresses[ChainId.BSC]
      )
      expect(mergedConfig.multicallAddresses[ChainId.ETH]).toEqual(
        configB.multicallAddresses[ChainId.ETH]
      )
    })
  })

  describe('updateChains', () => {
    it('should set rpcs/multicall address', async () => {
      const config = configService.updateChains(supportedChains)
      for (const chainId of Object.values(ChainId)) {
        // This is a workaround until we complete the transition to
        // supporting non EVM chains.
        try {
          // This will fail with SOL, SOLT, TER, TERT, OAS, OAST
          // as getChainById(ChainId) returns EVMChain
          chainsService.getChainById(chainId as ChainId)
        } catch {
          continue
        }
        if (typeof chainId !== 'string') {
          expect(config.rpcs[chainId].length).toBeGreaterThan(0)
        }
      }
    })

    it('should return the async config after updateChains was called', async () => {
      configService.updateChains(supportedChains)
      const config = await configService.getConfigAsync()

      expect(config).toBeDefined()
    })
  })
})
