import { type BaseToken, ChainType } from '@lifi/types'
import type {
  WalletCallReceipt as _WalletCallReceipt,
  Address,
  Client,
  FallbackTransportConfig,
  Hex,
} from 'viem'
import type { SDKProvider, SwitchChainHook } from '../types.js'

export interface EVMProviderOptions {
  getWalletClient?: () => Promise<Client>
  switchChain?: SwitchChainHook
  fallbackTransportConfig?: FallbackTransportConfig
}

export interface EVMProvider extends SDKProvider {
  options: EVMProviderOptions
  setOptions(options: EVMProviderOptions): void
  getWalletClient?(): Promise<Client>
}

export function isEVM(provider: SDKProvider): provider is EVMProvider {
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
