import {
  ChainType,
  type SDKProvider,
  type StepExecutorContext,
  type StepExecutorOptions,
} from '@lifi/sdk'

/**
 * Options passed to a wallet signing call. Mirrors the Stellar Wallets Kit
 * (`@creit.tech/stellar-wallets-kit`) signing surface so a widget adapter can
 * forward calls directly.
 */
export interface StellarSignOptions {
  networkPassphrase?: string
  address?: string
}

/**
 * Result of signing a transaction envelope — a base64 XDR string plus the
 * signer's public key. Matches the Stellar Wallets Kit `signTransaction` return.
 */
export interface StellarSignedTransaction {
  signedTxXdr: string
  signerAddress?: string
}

/**
 * Result of signing a Soroban authorization entry. Matches the Stellar Wallets
 * Kit `signAuthEntry` return. Not required for the router routes (source-account
 * auth), exposed for future-proofing.
 */
export interface StellarSignedAuthEntry {
  signedAuthEntry: string
  signerAddress?: string
}

/**
 * The minimal signer surface the SDK provider needs from a connected wallet.
 * The widget builds this adapter from the Stellar Wallets Kit instance.
 */
export interface StellarWallet {
  /** The connected G-address (source account). */
  address: string
  /** The network passphrase the wallet is expected to sign against. */
  networkPassphrase: string
  signTransaction: (
    xdr: string,
    opts?: StellarSignOptions
  ) => Promise<StellarSignedTransaction>
  signAuthEntry: (
    authEntry: string,
    opts?: StellarSignOptions
  ) => Promise<StellarSignedAuthEntry>
}

export interface StellarProviderOptions {
  getWallet?: () => Promise<StellarWallet>
  /**
   * Network passphrase for the Stellar network this provider targets.
   * Defaults to the public (mainnet) network.
   */
  networkPassphrase?: string
  /**
   * Optional Horizon REST endpoint used for balance/account reads. When omitted
   * the provider falls back to the Stellar RPC URLs resolved from the SDK client.
   */
  horizonUrl?: string
}

export interface StellarSDKProvider extends SDKProvider {
  setOptions(options: StellarProviderOptions): void
}

export function isStellarProvider(
  provider: SDKProvider
): provider is StellarSDKProvider {
  return provider.type === ChainType.STL
}

/** Phase 2 (execution) context — consumed by StellarStepExecutor + its tasks. */
export interface StellarTaskContext {
  /** Hash of the submitted transaction. */
  transactionHash?: string
}

export interface StellarStepExecutorContext
  extends StepExecutorContext,
    StellarTaskContext {
  wallet: StellarWallet
  networkPassphrase: string
  /** Base URLs for the Stellar RPC (JSON-RPC) endpoints used to submit + poll. */
  rpcUrls: string[]
}

export interface StellarStepExecutorOptions extends StepExecutorOptions {
  wallet: StellarWallet
  networkPassphrase: string
  rpcUrls: string[]
}
