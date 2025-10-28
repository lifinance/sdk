import {
  type BaseToken,
  ChainType,
  type LiFiStep,
  type LiFiStepExtended,
  type SDKProvider,
  type SwitchChainHook,
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
  switchChain?: SwitchChainHook
  fallbackTransportConfig?: FallbackTransportConfig
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
  /**
   * @deprecated
   */
  infiniteApproval?: boolean
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
