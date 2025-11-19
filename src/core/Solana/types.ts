import { ChainType } from '@lifi/types'
import type { Address, Transaction } from '@solana/kit'
import type { SDKProvider, StepExecutorOptions } from '../../types/core.js'

export interface SolanaProviderOptions {
  getWallet?: () => Promise<SolanaWallet>
}

export interface SolanaProvider extends SDKProvider {
  setOptions(options: SolanaProviderOptions): void
}

export function isSolana(provider: SDKProvider): provider is SolanaProvider {
  return provider.type === ChainType.SVM
}

export interface SolanaWallet {
  signTransaction(transaction: Transaction): Promise<Transaction>
  account: {
    address: Address
    publicKey: Uint8Array
  }
}

export interface SolanaStepExecutorOptions extends StepExecutorOptions {
  wallet: SolanaWallet
}

export const TokenProgramId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const Token2022ProgramId = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
