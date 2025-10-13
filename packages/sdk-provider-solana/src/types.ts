import type { SDKProvider, StepExecutorOptions } from '@lifi/sdk'
import { ChainType } from '@lifi/types'
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

export const TokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const Token2022ProgramId = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
