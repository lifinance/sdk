import { type BaseToken, ChainType } from '@lifi/types'
import type { Client, Hash } from 'viem'
import type { SwitchChainHook } from '../types.js'
import type { SDKProvider } from '../types.js'

export interface EVMProviderOptions {
  getWalletClient?: () => Promise<Client>
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
