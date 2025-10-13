import { ChainType, type StepExecutorOptions } from '@lifi/sdk'
import { isValidSuiAddress } from '@mysten/sui/utils'
import { getSuiBalance } from './actions/getSuiBalance.js'
import { resolveSuiAddress } from './address/resolveSuiAddress.js'
import { SuiStepExecutor } from './SuiStepExecutor.js'
import type { SuiProviderOptions, SuiSDKProvider } from './types.js'

export function SuiProvider(options?: SuiProviderOptions): SuiSDKProvider {
  const _options: SuiProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.MVM
    },
    isAddress: isValidSuiAddress,
    resolveAddress: resolveSuiAddress,
    getBalance: getSuiBalance,
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<SuiStepExecutor> {
      if (!_options.getWallet) {
        throw new Error('getWallet is not provided.')
      }

      const wallet = await _options.getWallet()

      const executor = new SuiStepExecutor({
        wallet,
        routeId: options.routeId,
        executionOptions: {
          ...options.executionOptions,
        },
      })

      return executor
    },
    setOptions(options: SuiProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
