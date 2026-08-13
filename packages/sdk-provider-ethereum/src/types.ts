import {
  type BaseToken,
  ChainType,
  type LiFiStep,
  type LiFiStepExtended,
  type SDKClient,
  type SDKProvider,
  type SDKStorage,
  type SignedTypedData,
  type StepExecutorContext,
  type TransactionMethodType,
  type TransactionParameters,
} from '@lifi/sdk'
import type {
  WalletCallReceipt as _WalletCallReceipt,
  Address,
  Client,
  FallbackTransportConfig,
  Hex,
} from 'viem'

export interface EthereumProviderOptions {
  getWalletClient?: () => Promise<Client>
  switchChain?: (chainId: number) => Promise<Client | undefined>
  fallbackTransportConfig?: FallbackTransportConfig
  safeApiKey?: string
  disableMessageSigning?: boolean
}

export interface EthereumTaskContext {
  disableMessageSigning: boolean
  transactionRequest?: TransactionParameters
  executionStrategy?: TransactionMethodType
  calls: Call[]
  signedTypedData: SignedTypedData[]
  hasMatchingPermit?: boolean
  hasAllowance?: boolean
  hasSufficientAllowance?: boolean
  /**
   * Whether the signer can produce a Permit2-verifiable signature — the
   * in-flight or settled lookup, memoized per execution by
   * `resolvePermit2Support` so the allowance tasks and the sign-and-execute task
   * can't disagree. Deliberately the promise and not a `boolean`: that would
   * be a tri-state (unresolved / yes / no) whose `false` case is
   * indistinguishable from "not looked up yet" under a truthiness check.
   */
  permit2SignerSupported?: Promise<boolean>
}

export interface EthereumStepExecutorContext
  extends StepExecutorContext,
    EthereumTaskContext {
  isFromNativeToken: boolean
  ethereumClient: Client
  checkClient: (
    step: LiFiStepExtended,
    targetChainId?: number
  ) => Promise<Client | undefined>
  switchChain?: (chainId: number) => Promise<Client | undefined>
  getStorage: (client: SDKClient) => SDKStorage
  /** Params passed when retrying executeStep (e.g. atomicityNotReady for 7702). */
  retryParams?: Record<string, unknown>
}

export interface EthereumSDKProvider extends SDKProvider {
  options: EthereumProviderOptions
  setOptions(options: EthereumProviderOptions): void
  getWalletClient?(): Promise<Client>
}

export function isEthereumProvider(
  provider: SDKProvider
): provider is EthereumSDKProvider {
  return provider.type === ChainType.EVM
}

export type TokenSpender = {
  token: BaseToken
  spenderAddress: string
}

export type TokenAllowance = {
  token: BaseToken
  allowance?: bigint
}

export type TokenSpenderAllowance = {
  token: BaseToken
  spenderAddress: string
  allowance?: bigint
}

export interface ApproveTokenRequest {
  walletClient: Client
  token: BaseToken
  spenderAddress: string
  amount: bigint
}

export interface RevokeApprovalRequest {
  walletClient: Client
  token: BaseToken
  spenderAddress: string
}

export type Call = {
  to: Address
  data?: Hex
  value?: bigint
  chainId?: number
}

export type WalletCallReceipt = _WalletCallReceipt<
  bigint,
  'success' | 'reverted'
> & {
  transactionLink?: string
}

export type RelayerStep = (LiFiStepExtended | LiFiStep) & {
  typedData: NonNullable<(LiFiStepExtended | LiFiStep)['typedData']>
}
