import { ChainType } from '@lifi/types'
import type { WalletWithFeatures } from '@mysten/wallet-standard'
import type {
  SolanaSignAndSendAllTransactionsFeature,
  SolanaSignAndSendTransactionFeature,
  SolanaSignInFeature,
  SolanaSignMessageFeature,
  SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features'
import type { SDKProvider, StepExecutorOptions } from '../types.js'

export interface SolanaProviderOptions {
  getWallet?: () => Promise<WalletWithSolanaFeatures>
}

export interface SolanaProvider extends SDKProvider {
  setOptions(options: SolanaProviderOptions): void
}

export function isSolana(provider: SDKProvider): provider is SolanaProvider {
  return provider.type === ChainType.SVM
}

export type SolanaFeatures = SolanaSignAndSendTransactionFeature &
  SolanaSignInFeature &
  SolanaSignMessageFeature &
  SolanaSignTransactionFeature &
  SolanaSignAndSendAllTransactionsFeature

export type WalletWithSolanaFeatures = WalletWithFeatures<SolanaFeatures>

export interface SolanaStepExecutorOptions extends StepExecutorOptions {
  wallet: WalletWithSolanaFeatures
}

export const TokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const Token2022ProgramId = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
