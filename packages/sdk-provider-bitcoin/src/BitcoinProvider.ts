import { isUTXOAddress } from '@bigmi/core'
import { ChainType, type StepExecutorOptions } from '@lifi/sdk'
import { getBitcoinBalance } from './actions/getBitcoinBalance.js'
import { resolveBitcoinAddress } from './address/resolveBitcoinAddress.js'
import { BitcoinStepExecutor } from './BitcoinStepExecutor.js'
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
