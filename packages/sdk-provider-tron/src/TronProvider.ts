import {
  ChainType,
  LiFiErrorCode,
  ProviderError,
  type StepExecutorOptions,
} from '@lifi/sdk'
import { TronWeb } from 'tronweb'
import { getTronBalance } from './actions/getTronBalance.js'
import { resolveTronAddress } from './actions/resolveTronAddress.js'
import { TronStepExecutor } from './core/TronStepExecutor.js'
import type { TronProviderOptions, TronSDKProvider } from './types.js'

export function TronProvider(options?: TronProviderOptions): TronSDKProvider {
  const _options: TronProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.TVM
    },
    isAddress: (address: string) => TronWeb.isAddress(address),
    resolveAddress: resolveTronAddress,
    getBalance: (client, walletAddress, tokens) =>
      getTronBalance(
        client,
        walletAddress,
        tokens,
        _options.multicallBatchSize
      ),
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<TronStepExecutor> {
      if (!_options.getWallet) {
        throw new ProviderError(
          LiFiErrorCode.ProviderUnavailable,
          'TronProvider requires a getWallet function.'
        )
      }

      const wallet = await _options.getWallet()

      const executor = new TronStepExecutor({
        wallet,
        routeId: options.routeId,
        executionOptions: {
          ...options.executionOptions,
        },
      })

      return executor
    },
    setOptions(options: TronProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
