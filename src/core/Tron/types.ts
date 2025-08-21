import type { ChainType } from '@lifi/types'
import type { Adapter } from '@tronweb3/tronwallet-abstract-adapter'
import type { SDKProvider, StepExecutorOptions } from '../types.js'

export interface TronProviderOptions {
  getWallet?: () => Promise<Adapter>
}

export interface TronProvider extends SDKProvider {
  setOptions: (options: TronProviderOptions) => void
}

export function isTron(provider: SDKProvider): provider is TronProvider {
  return provider.type === ('TVM' as ChainType)
}

export interface TronStepExecutorOptions extends StepExecutorOptions {
  wallet: Adapter
}
