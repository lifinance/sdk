import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
  SolanaSignIn,
  type SolanaSignInFeature,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features'
import type { Wallet } from '@wallet-standard/base'

// Map feature identifiers to their corresponding feature property types
type FeatureMap = {
  [SolanaSignTransaction]: SolanaSignTransactionFeature[typeof SolanaSignTransaction]
  [SolanaSignMessage]: SolanaSignMessageFeature[typeof SolanaSignMessage]
  [SolanaSignAndSendTransaction]: SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction]
  [SolanaSignIn]: SolanaSignInFeature[typeof SolanaSignIn]
}

/**
 * Helper function to safely extract a feature's properties from a wallet.
 *
 * This handles the TypeScript union type issue where wallet.features is typed as a union
 * but at runtime is actually a record containing multiple features.
 *
 * @param wallet - The wallet instance
 * @param featureName - The feature identifier constant
 * @returns The feature's properties object
 * @throws Error if the wallet doesn't support the requested feature
 *
 * @example
 * import { SolanaSignTransaction } from '@solana/wallet-standard-features'
 *
 * const { signTransaction } = getWalletFeature(wallet, SolanaSignTransaction)
 */
export function getWalletFeature<K extends keyof FeatureMap>(
  wallet: Wallet,
  featureName: K
): FeatureMap[K] {
  if (!(featureName in wallet.features)) {
    throw new Error(`Wallet does not support feature: ${featureName}`)
  }

  // At runtime, wallet.features is a record keyed by feature identifiers
  // Cast to access the specific feature
  return (wallet.features as Record<K, FeatureMap[K]>)[featureName]
}
