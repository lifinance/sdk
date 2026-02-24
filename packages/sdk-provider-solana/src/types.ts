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

export interface SolanaTaskOutputs extends Record<string, unknown> {
  signedTransactions?: Transaction[]
}

export interface SolanaStepExecutorContext extends StepExecutorContext {
  wallet: Wallet
  walletAccount: WalletAccount
  tasksResults: SolanaTaskOutputs
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
