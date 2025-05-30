import { ChainType } from '@lifi/types'
import type { SignerWalletAdapter } from '@solana/wallet-adapter-base'
import type { SDKProvider, StepExecutorOptions } from '../types.js'

export interface SolanaProviderOptions {
  getWalletAdapter?: () => Promise<SignerWalletAdapter>
}

export interface SolanaProvider extends SDKProvider {
  setOptions(options: SolanaProviderOptions): void
}

export function isSolana(provider: SDKProvider): provider is SolanaProvider {
  return provider.type === ChainType.SVM
}

export interface SolanaStepExecutorOptions extends StepExecutorOptions {
  walletAdapter: SignerWalletAdapter
}

export const TokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const Token2022ProgramId = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
