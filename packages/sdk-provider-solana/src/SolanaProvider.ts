import {
  ChainType,
  LiFiErrorCode,
  ProviderError,
  type StepExecutorOptions,
} from '@lifi/sdk'
import { isAddress } from '@solana/kit'
import { getSolanaBalance } from './actions/getSolanaBalance.js'
import { resolveSolanaAddress } from './actions/resolveSolanaAddress.js'
import { SolanaStepExecutor } from './core/SolanaStepExecutor.js'
import type { SolanaProviderOptions, SolanaSDKProvider } from './types.js'

export function SolanaProvider(
  options?: SolanaProviderOptions
): SolanaSDKProvider {
  const _options: SolanaProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.SVM
    },
    isAddress,
    resolveAddress: resolveSolanaAddress,
    getBalance: getSolanaBalance,
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<SolanaStepExecutor> {
      if (!_options.getWallet) {
        throw new ProviderError(
          LiFiErrorCode.ConfigError,
          'SolanaProvider requires a getWallet function'
        )
      }

      const wallet = await _options.getWallet()

      const executor = new SolanaStepExecutor({
        wallet,
        routeId: options.routeId,
        executionOptions: {
          ...options.executionOptions,
        },
      })

      return executor
    },
    setOptions(options: SolanaProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
