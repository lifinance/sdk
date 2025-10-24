import { ChainType, type StepExecutorOptions } from '@lifi/sdk'
import { getSolanaBalance } from './getSolanaBalance.js'
import { isSolanaAddress } from './isSolanaAddress.js'
import { resolveSolanaAddress } from './resolveSolanaAddress.js'
import { SolanaStepExecutor } from './SolanaStepExecutor.js'
import type { SolanaProviderOptions, SolanaSDKProvider } from './types.js'

export function SolanaProvider(
  options?: SolanaProviderOptions
): SolanaSDKProvider {
  const _options: SolanaProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.SVM
    },
    isAddress: isSolanaAddress,
    resolveAddress: resolveSolanaAddress,
    getBalance: getSolanaBalance,
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<SolanaStepExecutor> {
      if (!_options.getWalletAdapter) {
        throw new Error('getWalletAdapter is not provided.')
      }

      const walletAdapter = await _options.getWalletAdapter()

      const executor = new SolanaStepExecutor({
        walletAdapter,
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
