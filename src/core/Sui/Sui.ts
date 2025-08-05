import { ChainType } from '@lifi/types'
import { isValidSuiAddress } from '@mysten/sui/utils'
import type { StepExecutorOptions } from '../types.js'
import { getSuiBalance } from './getSuiBalance.js'
import { resolveSuiAddress } from './resolveSuiAddress.js'
import { SuiStepExecutor } from './SuiStepExecutor.js'
import type { SuiProvider, SuiProviderOptions } from './types.js'

export function Sui(options?: SuiProviderOptions): SuiProvider {
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
