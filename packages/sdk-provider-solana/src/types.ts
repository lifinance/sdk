import {
  ChainType,
  type SDKProvider,
  type StepExecutorOptions,
} from '@lifi/sdk'
import type { SignerWalletAdapter } from '@solana/wallet-adapter-base'

export interface SolanaProviderOptions {
  getWalletAdapter?: () => Promise<SignerWalletAdapter>
}

export interface SolanaSDKProvider extends SDKProvider {
  setOptions(options: SolanaProviderOptions): void
}

export function isSolanaProvider(
  provider: SDKProvider
): provider is SolanaSDKProvider {
  return provider.type === ChainType.SVM
}

export interface SolanaStepExecutorOptions extends StepExecutorOptions {
  walletAdapter: SignerWalletAdapter
}
