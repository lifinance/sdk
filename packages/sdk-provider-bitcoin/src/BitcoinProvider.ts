import { isUTXOAddress } from '@bigmi/core'
import { ChainId, ChainType, type StepExecutorOptions } from '@lifi/sdk'
import { getBitcoinBalance } from './actions/getBitcoinBalance.js'
import { resolveBitcoinAddress } from './actions/resolveBitcoinAddress.js'
import { BitcoinStepExecutor } from './core/BitcoinStepExecutor.js'
import type { BitcoinProviderOptions, BitcoinSDKProvider } from './types.js'
import { isZcashAddress } from './utils/zcashAddress.js'

// Each UTXO chain has its own address format. A chain this provider does not
// know is refused, so a Bitcoin address never passes as its receiver. The chain
// ID must not reach bigmi, which reads a second argument as a network.
const isAddress = (address: string, chainId?: ChainId): boolean => {
  switch (chainId) {
    case undefined:
    case ChainId.BTC:
      return isUTXOAddress(address)
    case ChainId.ZEC:
      return isZcashAddress(address)
    default:
      return false
  }
}

export function BitcoinProvider(
  options?: BitcoinProviderOptions
): BitcoinSDKProvider {
  const _options: BitcoinProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.UTXO
    },
    isAddress,
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
