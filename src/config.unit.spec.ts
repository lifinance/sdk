import { ChainId } from '@lifinance/types'
import { getDefaultConfig, mergeConfig } from './config'

describe('config', () => {
  describe('getDefaultConfig', () => {
    it('should return the default config', () => {
      const defaultConfig = getDefaultConfig()

      expect(defaultConfig.apiUrl).toEqual('https://li.quest/v1/')
      expect(defaultConfig.defaultRouteOptions).toEqual({})
      expect(defaultConfig.rpcs).toBeDefined()
      expect(defaultConfig.multicallAddresses).toBeDefined()
      expect(
        defaultConfig.defaultExecutionSettings.updateCallback
      ).toBeDefined()
      expect(
        defaultConfig.defaultExecutionSettings.switchChainHook
      ).toBeDefined()
    })
  })

  describe('mergeConfig', () => {
    it('should return a if b is empty', () => {
      const configA = getDefaultConfig()
      const configB = {}
      const mergedConfig = mergeConfig(configA, configB)

      expect(mergedConfig).toEqual(configA)
    })

    it('should overwrite the api url if set', () => {
      const configA = getDefaultConfig()
      const configB = {
        apiUrl: 'some other api url',
      }
      const mergedConfig = mergeConfig(configA, configB)

      expect(mergedConfig.apiUrl).toEqual(configB.apiUrl)
    })

    it('should merge the default route options', () => {
      const configA = getDefaultConfig()
      configA.defaultRouteOptions = {
        infiniteApproval: true,
        slippage: 0.3,
      }
      const configB = {
        defaultRouteOptions: {
          slippage: 0,
        },
      }
      const mergedConfig = mergeConfig(configA, configB)

      expect(mergedConfig.defaultRouteOptions.infiniteApproval).toEqual(
        configA.defaultRouteOptions.infiniteApproval
      )
      expect(mergedConfig.defaultRouteOptions.slippage).toEqual(
        configB.defaultRouteOptions.slippage
      )
    })

    it('should merge the default execution settings', () => {
      const configA = getDefaultConfig()
      const configB = {
        defaultExecutionSettings: {
          updateCallback: () => 'something else',
        },
      }
      const mergedConfig = mergeConfig(configA, configB)

      expect(mergedConfig.defaultExecutionSettings.switchChainHook).toEqual(
        configA.defaultExecutionSettings.switchChainHook
      )
      expect(mergedConfig.defaultExecutionSettings.updateCallback).toEqual(
        configB.defaultExecutionSettings.updateCallback
      )
    })

    it('should overwrite rpcs for the passed chains and leave the others untouched', () => {
      const configA = getDefaultConfig()
      const configB = {
        rpcs: {
          [ChainId.ETH]: ['some other rpc'],
        },
      }
      const mergedConfig = mergeConfig(configA, configB)

      expect(mergedConfig.rpcs[ChainId.BSC]).toEqual(configA.rpcs[ChainId.BSC])
      expect(mergedConfig.rpcs[ChainId.ETH]).toEqual(configB.rpcs[ChainId.ETH])
    })

    it('should overwrite multicallAddresses for the passed chains and leave the others untouched', () => {
      const configA = getDefaultConfig()
      const configB = {
        multicallAddresses: {
          [ChainId.ETH]: 'some other multicallAddress',
        },
      }
      const mergedConfig = mergeConfig(configA, configB)

      expect(mergedConfig.multicallAddresses[ChainId.BSC]).toEqual(
        configA.multicallAddresses[ChainId.BSC]
      )
      expect(mergedConfig.multicallAddresses[ChainId.ETH]).toEqual(
        configB.multicallAddresses[ChainId.ETH]
      )
    })
  })
})
