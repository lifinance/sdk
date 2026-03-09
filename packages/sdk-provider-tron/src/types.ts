import {
  ChainType,
  type LiFiStepExtended,
  type SDKProvider,
  type StepExecutorContext,
  type StepExecutorOptions,
} from '@lifi/sdk'
import type { Adapter } from '@tronweb3/tronwallet-abstract-adapter'
import type { SignedTransaction } from 'tronweb/lib/esm/types/Transaction'

export interface TronProviderOptions {
  getWallet?: () => Promise<Adapter>
}

export interface TronTaskContext {
  signedTransaction?: SignedTransaction
}

export interface TronStepExecutorContext
  extends StepExecutorContext,
    TronTaskContext {
  wallet: Adapter
  checkWallet: (step: LiFiStepExtended) => void
}

export interface TronSDKProvider extends SDKProvider {
  setOptions(options: TronProviderOptions): void
}

export function isTronProvider(
  provider: SDKProvider
): provider is TronSDKProvider {
  return provider.type === ChainType.TVM
}

export interface TronStepExecutorOptions extends StepExecutorOptions {
  wallet: Adapter
}
