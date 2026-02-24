import {
  ChainType,
  LiFiErrorCode,
  ProviderError,
  type StepExecutorOptions,
} from '@lifi/sdk'
import { isValidSuiAddress } from '@mysten/sui/utils'
import { getSuiBalance } from './actions/getSuiBalance.js'
import { resolveSuiAddress } from './actions/resolveSuiAddress.js'
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
      if (!_options.getClient) {
        throw new ProviderError(
          LiFiErrorCode.ProviderUnavailable,
          'getClient is not provided.'
        )
      }
      if (!_options.getSigner) {
        throw new ProviderError(
          LiFiErrorCode.ProviderUnavailable,
          'getSigner is not provided.'
        )
      }

      const client = await _options.getClient()
      const signer = await _options.getSigner()

      const executor = new SuiStepExecutor({
        client,
        signer,
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
