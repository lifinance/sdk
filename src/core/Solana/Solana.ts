import { ChainType } from '@lifi/types'
import type { StepExecutorOptions } from '../types.js'
import { getSolanaBalance } from './getSolanaBalance.js'
import { isSVMAddress } from './isSVMAddress.js'
import { resolveSolanaAddress } from './resolveSolanaAddress.js'
import { SolanaStepExecutor } from './SolanaStepExecutor.js'
import type { SolanaProvider, SolanaProviderOptions } from './types.js'

export function Solana(options?: SolanaProviderOptions): SolanaProvider {
  const _options: SolanaProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.SVM
    },
    isAddress: isSVMAddress,
    resolveAddress: resolveSolanaAddress,
    getBalance: getSolanaBalance,
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<SolanaStepExecutor> {
      if (!_options.getSolanaClient) {
        throw new Error('getSolanaClient is not provided.')
      }

      const solanaClient = await _options.getSolanaClient()

      const executor = new SolanaStepExecutor({
        solanaClient,
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
