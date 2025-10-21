import { ChainType, type Token } from '@lifi/types'
import { type Address, type FallbackTransportConfig, isAddress } from 'viem'
import type { SDKBaseConfig, StepExecutorOptions } from '../types.js'
import { EVMStepExecutor } from './EVMStepExecutor.js'
import { getEVMBalance } from './getEVMBalance.js'
import { resolveEVMAddress } from './resolveEVMAddress.js'
import type { EVMProvider, EVMProviderOptions } from './types.js'

export function EVM(options?: EVMProviderOptions): EVMProvider {
  const _options: EVMProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.EVM
    },
    get options() {
      return _options
    },
    isAddress,
    resolveAddress: resolveEVMAddress,
    getBalance: (
      config: SDKBaseConfig,
      walletAddress: Address,
      tokens: Token[]
    ) =>
      getEVMBalance(
        config,
        walletAddress,
        tokens,
        _options.fallbackTransportConfig as FallbackTransportConfig
      ),
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
        provider: this,
      })

      return executor
    },
    setOptions(options: EVMProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
