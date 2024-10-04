import { ChainType } from '@lifi/types'
import type { StepExecutorOptions } from '../types.js'
import { SolanaStepExecutor } from './SolanaStepExecutor.js'
import { getSNSAddress } from './getSNSAddress.js'
import { getSolanaBalance } from './getSolanaBalance.js'
import { isSVMAddress } from './isSVMAddress.js'
import type { SolanaProvider, SolanaProviderOptions } from './types.js'

export function Solana(options?: SolanaProviderOptions): SolanaProvider {
  const _options: SolanaProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.SVM
    },
    isAddress: isSVMAddress,
    resolveAddress: getSNSAddress,
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
