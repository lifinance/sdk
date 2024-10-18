import { ChainType } from '@lifi/types'
import type { SignerWalletAdapter } from '@solana/wallet-adapter-base'
import type { SDKProvider } from '../types.js'

export interface SolanaProviderOptions {
  getWalletAdapter?: () => Promise<SignerWalletAdapter>
}

export interface SolanaProvider extends SDKProvider {
  setOptions(options: SolanaProviderOptions): void
}

export function isSolana(provider: SDKProvider): provider is SolanaProvider {
  return provider.type === ChainType.SVM
}

export const TokenProgramAddress = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
