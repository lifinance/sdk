import { ChainType, type StepExecutorOptions } from '@lifi/sdk'
import { isAddress } from 'viem'
import * as chains from 'viem/chains'
import { getEthereumBalance } from './actions/getEthereumBalance.js'
import { resolveEthereumAddress } from './actions/resolveEthereumAddress.js'
import { EthereumStepExecutor } from './core/EthereumStepExecutor.js'
import type { EthereumProviderOptions, EthereumSDKProvider } from './types.js'

/** The wallet format without the checksum: a pasted address keeps its case. */
function isEthereumTokenAddress(address: string): boolean {
  return isAddress(address, { strict: false })
}

/** viem reads a second argument as options, so a chain ID must not reach it. */
function isEthereumAddress(address: string): boolean {
  return isAddress(address)
}

export function EthereumProvider(
  options?: EthereumProviderOptions
): EthereumSDKProvider {
  const _options: EthereumProviderOptions = options ?? {}
  // DEMO ONLY, reverted in the next commit: grows the bundle to show the size report.
  ;(globalThis as Record<string, unknown>).__bundleSizeDemo = chains
  return {
    get type() {
      return ChainType.EVM
    },
    get options() {
      return _options
    },
    isAddress: isEthereumAddress,
    isTokenAddress: isEthereumTokenAddress,
    resolveAddress: resolveEthereumAddress,
    getBalance: getEthereumBalance,
    getWalletClient: _options.getWalletClient,
    async getStepExecutor(
      options: StepExecutorOptions
    ): Promise<EthereumStepExecutor> {
      if (!_options.getWalletClient) {
        throw new Error('Client is not provided.')
      }

      const walletClient = await _options.getWalletClient()

      const executor = new EthereumStepExecutor({
        client: walletClient,
        switchChain: _options.switchChain,
        disableMessageSigning: _options.disableMessageSigning,
        routeId: options.routeId,
        executionOptions: {
          ...options.executionOptions,
        },
      })

      return executor
    },
    setOptions(options: EthereumProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
