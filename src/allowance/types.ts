import type { Token } from '@lifi/types'
import type { WalletClient } from 'viem'

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
