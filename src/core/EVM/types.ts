import { ChainType, type BaseToken } from '@lifi/types'
import type { Hash, WalletClient } from 'viem'
import type { SwitchChainHook } from '../types.js'
import { type SDKProvider } from '../types.js'

export interface EVMProviderOptions {
  getWalletClient?: () => Promise<WalletClient>
  switchChain?: SwitchChainHook
  multisig?: MultisigConfig
}

export interface EVMProvider extends SDKProvider {
  setOptions(options: EVMProviderOptions): void
  multisig?: MultisigConfig
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
  walletClient: WalletClient
  token: BaseToken
  spenderAddress: string
  amount: bigint
  infiniteApproval?: boolean
}

export interface RevokeApprovalRequest {
  walletClient: WalletClient
  token: BaseToken
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
