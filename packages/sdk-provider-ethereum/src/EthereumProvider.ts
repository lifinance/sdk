import type { StepExecutorOptions } from '@lifi/sdk'
import { ChainType } from '@lifi/types'
import { isAddress } from 'viem'
import { EVMStepExecutor } from './EthereumStepExecutor.js'
import { getEthereumBalance } from './getEthereumBalance.js'
import { resolveEthereumAddress } from './resolveEthereumAddress.js'
import type { EthereumProviderOptions, EthereumSDKProvider } from './types.js'

export function EthereumProvider(
  options?: EthereumProviderOptions
): EthereumSDKProvider {
  const _options: EthereumProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.EVM
    },
    get options() {
      return _options
    },
    isAddress,
    resolveAddress: resolveEthereumAddress,
    getBalance: getEthereumBalance,
    getWalletClient: _options.getWalletClient,
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<EVMStepExecutor> {
      if (!_options.getWalletClient) {
        throw new Error('Client is not provided.')
      }

      const walletClient = await _options.getWalletClient()

      const executor = new EVMStepExecutor({
        client: walletClient,
        routeId: options.routeId,
        executionOptions: {
          ...options.executionOptions,
          switchChainHook:
            _options.switchChain ?? options.executionOptions?.switchChainHook,
        },
      })

      return executor
    },
    setOptions(options: EthereumProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
