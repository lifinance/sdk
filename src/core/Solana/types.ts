import { ChainType, type ChainId } from '@lifi/types'
import { type SDKProvider } from 'core/types.js'

export interface SolanaProviderOptions {
  getWalletClient?: () => Promise<unknown>
}

export interface SolanaProvider extends SDKProvider {
  rpcUrls?: Record<ChainId, string[]>
  setOptions(options: SolanaProviderOptions): void
}

export function isSolana(provider: SDKProvider): provider is SolanaProvider {
  return provider.type === ChainType.SVM
}
