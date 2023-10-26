import { ChainType, type ChainId, type Token } from '@lifi/types'
import type { Hash, WalletClient } from 'viem'
import type { SwitchChainHook } from '../types.js'
import { type SDKProvider } from '../types.js'

export interface EVMProviderOptions {
  getWalletClient?: () => Promise<WalletClient>
  switchChain?: SwitchChainHook
  multicall?: Partial<Record<ChainId, string>>
  multisig?: MultisigConfig
}

export interface EVMProvider extends SDKProvider {
  setOptions(options: EVMProviderOptions): void
  multicall?: Partial<Record<ChainId, string>>
  multisig?: MultisigConfig
}

export function isEVM(provider: SDKProvider): provider is EVMProvider {
  return provider.type === ChainType.EVM
}

export type TokenSpender = {
  token: Token
  spenderAddress: string
}

export type TokenAllowance = {
  token: Token
  allowance?: bigint
}

export type TokenSpenderAllowance = {
  token: Token
  spenderAddress: string
  allowance?: bigint
}

export interface ApproveTokenRequest {
  walletClient: WalletClient
  token: Token
  spenderAddress: string
  amount: bigint
  infiniteApproval?: boolean
}

export interface RevokeApprovalRequest {
  walletClient: WalletClient
  token: Token
  spenderAddress: string
}

export interface MultisigTxDetails {
  status: 'DONE' | 'FAILED' | 'PENDING' | 'CANCELLED'
  txHash?: Hash
}

export interface MultisigTransaction {
  to: string
  value?: bigint
  data: string
}

export interface MultisigConfig {
  isMultisigWalletClient: boolean
  getMultisigTransactionDetails: (
    txHash: Hash,
    fromChainId: number,
    updateIntermediateStatus?: () => void
  ) => Promise<MultisigTxDetails>
  sendBatchTransaction?: (
    batchTransactions: MultisigTransaction[]
  ) => Promise<Hash>
  shouldBatchTransactions?: boolean
}
