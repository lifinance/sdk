import { isUTXOAddress } from '@bigmi/core'
import { ChainType } from '@lifi/types'
import type { StepExecutorOptions } from '../types.js'
import { getUTXOBalance } from './getUTXOBalance.js'
import { resolveUTXOAddress } from './resolveUTXOAddress.js'
import type { UTXOProvider, UTXOProviderOptions } from './types.js'
import { UTXOStepExecutor } from './UTXOStepExecutor.js'

export function UTXO(options?: UTXOProviderOptions): UTXOProvider {
  const _options: UTXOProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.UTXO
    },
    isAddress: isUTXOAddress,
    resolveAddress: resolveUTXOAddress,
    getBalance: getUTXOBalance,
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<UTXOStepExecutor> {
      if (!_options.getWalletClient) {
        throw new Error('Client is not provided.')
      }

      const walletClient = await _options.getWalletClient()

      const executor = new UTXOStepExecutor({
        client: walletClient,
        routeId: options.routeId,
        executionOptions: {
          ...options.executionOptions,
        },
      })

      return executor
    },
    setOptions(options: UTXOProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
