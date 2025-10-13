import { isUTXOAddress } from '@bigmi/core'
import type { StepExecutorOptions } from '@lifi/sdk'
import { ChainType } from '@lifi/types'
import { BitcoinStepExecutor } from './BitcoinStepExecutor.js'
import { getBitcoinBalance } from './getBitcoinBalance.js'
import { resolveBitcoinAddress } from './resolveBitcoinAddress.js'
import type { BitcoinProviderOptions, BitcoinSDKProvider } from './types.js'

export function BitcoinProvider(
  options?: BitcoinProviderOptions
): BitcoinSDKProvider {
  const _options: BitcoinProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.UTXO
    },
    isAddress: isUTXOAddress,
    resolveAddress: resolveBitcoinAddress,
    getBalance: getBitcoinBalance,
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<BitcoinStepExecutor> {
      if (!_options.getWalletClient) {
        throw new Error('Client is not provided.')
      }

      const walletClient = await _options.getWalletClient()

      const executor = new BitcoinStepExecutor({
        client: walletClient,
        routeId: options.routeId,
        executionOptions: {
          ...options.executionOptions,
        },
      })

      return executor
    },
    setOptions(options: BitcoinProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
