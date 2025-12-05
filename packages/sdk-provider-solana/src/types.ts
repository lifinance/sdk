import {
  ChainType,
  type SDKProvider,
  type StepExecutorOptions,
} from '@lifi/sdk'
import type { Address, Transaction } from '@solana/kit'

export interface SolanaProviderOptions {
  getWallet?: () => Promise<SolanaWallet>
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
  wallet: SolanaWallet
}

export interface WalletAccount {
  address: Address
  publicKey: Uint8Array
}
export interface SolanaWallet {
  signTransaction(transaction: Transaction): Promise<Transaction>
  account: WalletAccount
}
