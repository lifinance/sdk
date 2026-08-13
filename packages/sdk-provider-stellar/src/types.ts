import {
  ChainType,
  type LiFiStepExtended,
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
  /**
   * Optional: the router routes use source-account auth, so the SDK never calls
   * this. Present so an adapter can forward the Stellar Wallets Kit method.
   */
  signAuthEntry?: (
    authEntry: string,
    opts?: StellarSignOptions
  ) => Promise<StellarSignedAuthEntry>
}

export interface StellarProviderOptions {
  getWallet?: () => Promise<StellarWallet>
  /**
   * Network passphrase for the Stellar network this provider targets.
   * Defaults to the public (mainnet) network.
   *
   * Balance reads follow this option alone. Signing prefers it and falls back
   * to the connected wallet's passphrase, and `StellarStepExecutor.checkWallet`
   * refuses to sign when the two disagree — so a wallet on a different network
   * fails before the user signs, while balances still read against the option.
   */
  networkPassphrase?: string
}

export interface StellarSDKProvider extends SDKProvider {
  setOptions(options: StellarProviderOptions): void
}

export function isStellarProvider(
  provider: SDKProvider
): provider is StellarSDKProvider {
  return provider.type === ChainType.STL
}

/**
 * A SAC allowance an included leg of a Stellar route needs before the route can
 * be executed. Resolved by {@link resolveApprovalRequirement}.
 */
export interface StellarApprovalRequirement {
  /** Soroban `C`-address that calls `transfer_from` and so consumes the allowance. */
  spender: string
  /** SAC contract id of the token the allowance is written against. */
  tokenAddress: string
  /** Amount the allowance has to cover. */
  amount: bigint
}

/** Execution context passed between {@link StellarStepExecutor} tasks. */
export interface StellarTaskContext {
  /** Hash of the submitted route transaction. */
  transactionHash?: string
  /**
   * Resolved SAC allowance requirement, or `undefined` when no included leg
   * needs one. Set by `StellarCheckAllowanceTask`.
   */
  approval?: StellarApprovalRequirement
  /** Whether the sender's SAC allowance already covers {@link approval}. */
  hasSufficientAllowance?: boolean
}

export interface StellarStepExecutorContext
  extends StepExecutorContext,
    StellarTaskContext {
  wallet: StellarWallet
  networkPassphrase: string
  checkWallet: (step: LiFiStepExtended) => void
}

export interface StellarStepExecutorOptions extends StepExecutorOptions {
  wallet: StellarWallet
  networkPassphrase: string
}
