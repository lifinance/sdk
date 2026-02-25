import {
  ChainType,
  type SDKProvider,
  type StepExecutorContext,
  type StepExecutorOptions,
} from '@lifi/sdk'
import type { Transaction } from '@solana/kit'
import type { Wallet, WalletAccount } from '@wallet-standard/base'

export interface SolanaProviderOptions {
  getWallet?: () => Promise<Wallet>
}

export interface SolanaTaskContext {
  signedTransactions?: Transaction[]
}

export interface SolanaStepExecutorContext
  extends StepExecutorContext,
    SolanaTaskContext {
  wallet: Wallet
  walletAccount: WalletAccount
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
  wallet: Wallet
}
