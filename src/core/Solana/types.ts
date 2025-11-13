import { ChainType } from '@lifi/types'
import type { SolanaClient } from '@solana/client'
import type { SDKProvider, StepExecutorOptions } from '../types.js'

export interface SolanaProviderOptions {
  getSolanaClient?: () => Promise<SolanaClient>
}

export interface SolanaProvider extends SDKProvider {
  setOptions(options: SolanaProviderOptions): void
}

export function isSolana(provider: SDKProvider): provider is SolanaProvider {
  return provider.type === ChainType.SVM
}

export interface SolanaStepExecutorOptions extends StepExecutorOptions {
  solanaClient: SolanaClient
}

export const TokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const Token2022ProgramId = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
