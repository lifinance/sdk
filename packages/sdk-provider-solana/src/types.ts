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
  skipSimulation?: boolean
  /**
   * RPCs that send transactions and Jito bundles, in place of the client's
   * Solana `rpcUrls`. Transactions go to every write RPC; bundles go to the
   * write RPCs that pass the Jito capability probe, and fall back to the
   * Jito-capable `rpcUrls` when none does. Reads, simulation and confirmation
   * stay on the client's `rpcUrls`: apart from that probe (one
   * `getBundleStatuses` call per URL, cached), a write RPC receives no reads.
   * Unset or empty, the client's `rpcUrls` send as well.
   */
  writeRpcUrls?: string[]
}

export interface SolanaTaskContext {
  signedTransactions?: Transaction[]
  /**
   * Whether the backend returned a Jito bundle (array `transactionRequest.data`)
   * that must be submitted via `sendBundle` instead of `sendTransaction`.
   */
  isBundleExecution?: boolean
}

export interface SolanaStepExecutorContext
  extends StepExecutorContext,
    SolanaTaskContext {
  wallet: Wallet
  walletAccount: WalletAccount
  skipSimulation: boolean
  writeRpcUrls?: string[]
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
  skipSimulation?: boolean
  writeRpcUrls?: string[]
}
