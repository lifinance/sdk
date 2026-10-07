import {
  ChainType,
  type LiFiStepExtended,
  type SDKProvider,
  type StepExecutorContext,
  type StepExecutorOptions,
} from '@lifi/sdk'
import type { Transaction } from '@solana/kit'
import type { Wallet, WalletAccount } from '@wallet-standard/base'

export interface SolanaProviderOptions {
  getWallet?: () => Promise<Wallet>
  skipSimulation?: boolean
}

export interface SolanaTaskContext {
  /**
   * Set by the sign task. Absent on a resume: the wait tasks then read the
   * signed bytes from the action's `txHex`.
   */
  signedTransactions?: Transaction[]
  /**
   * Whether the backend returned a Jito bundle (array `transactionRequest.data`)
   * that must be submitted via `sendBundle` instead of `sendTransaction`.
   * Absent on a resume: a leading `[` in `txHex` marks a bundle then.
   */
  isBundleExecution?: boolean
}

export interface SolanaStepExecutorContext
  extends StepExecutorContext,
    SolanaTaskContext {
  wallet: Wallet
  /**
   * Resolves the account that requested the quote. Only the sign task calls
   * it, so a resume that only waits does not need the wallet to have
   * reconnected. Throws `WalletChangedDuringExecution` when the account is
   * gone.
   */
  getWalletAccount: (step: LiFiStepExtended) => WalletAccount
  skipSimulation: boolean
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
}
