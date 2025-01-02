import { type BaseToken, ChainType } from '@lifi/types'
import type { Client } from 'viem'
import type { LiFiStepExtended, SwitchChainHook } from '../types.js'
import type { SDKProvider } from '../types.js'
import type { PermitData } from './permit2/domain.js'
import type {
  PermitTransferFrom,
  Witness,
} from './permit2/signatureTransfer.js'

export interface EVMProviderOptions {
  getWalletClient?: () => Promise<Client>
  switchChain?: SwitchChainHook
}

export interface EVMProvider extends SDKProvider {
  setOptions(options: EVMProviderOptions): void
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

export interface EVMPermitStep extends LiFiStepExtended {
  permit: PermitTransferFrom
  permitData: PermitData
  witness: Witness
}
