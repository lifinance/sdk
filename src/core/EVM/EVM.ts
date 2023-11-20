import { ChainType } from '@lifi/types'
import { isAddress } from 'viem'
import type { StepExecutorOptions } from '../types.js'
import { EVMStepExecutor } from './EVMStepExecutor.js'
import { getEVMBalance } from './getEVMBalance.js'
import type { EVMProvider, EVMProviderOptions } from './types.js'

export function EVM(options?: EVMProviderOptions): EVMProvider {
  const _options: EVMProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.EVM
    },
    get multisig() {
      return _options.multisig
    },
    isAddress(address: string): boolean {
      return isAddress(address)
    },
    getBalance: getEVMBalance,
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<EVMStepExecutor> {
      if (!_options.getWalletClient) {
        throw new Error(`getWalletClient is not provided.`)
      }

      const walletClient = await _options.getWalletClient()

      const executor = new EVMStepExecutor({
        walletClient,
        multisig: _options.multisig,
        routeId: options.routeId,
        executionOptions: {
          ...options.executionOptions,
          switchChainHook:
            _options.switchChain ?? options.executionOptions?.switchChainHook,
        },
      })

      return executor
    },
    setOptions(options: EVMProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
