import type { Route, Token } from '@lifi/types'
import type { Hash, Hex, WalletClient } from 'viem'

export type TransactionParameters = {
  chainId?: number
  to?: string
  from?: string
  nonce?: number
  data?: Hex
  value?: bigint
  gas?: bigint
  gasPrice?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
}

export type UpdateRouteHook = (updatedRoute: Route) => void

export interface TransactionRequestParameters extends TransactionParameters {
  requestType: 'approve' | 'transaction'
}

export type TransactionRequestUpdateHook = (
  updatedTxRequest: TransactionRequestParameters
) => Promise<TransactionParameters>

export type SwitchChainHook = (
  requiredChainId: number
) => Promise<WalletClient | undefined>

export interface AcceptSlippageUpdateHookParams {
  toToken: Token
  oldToAmount: string
  newToAmount: string
  oldSlippage: number
  newSlippage: number
}

export type AcceptSlippageUpdateHook = (
  params: AcceptSlippageUpdateHookParams
) => Promise<boolean | undefined>

export interface ExchangeRateUpdateParams {
  toToken: Token
  oldToAmount: string
  newToAmount: string
}

export type AcceptExchangeRateUpdateHook = (
  params: ExchangeRateUpdateParams
) => Promise<boolean | undefined>

export type ExecutionSettings = Partial<InternalExecutionSettings>

export interface InternalExecutionSettings {
  acceptExchangeRateUpdateHook: AcceptExchangeRateUpdateHook
  switchChainHook: SwitchChainHook
  updateRouteHook: UpdateRouteHook
  updateTransactionRequestHook?: TransactionRequestUpdateHook
  executeInBackground: boolean
  infiniteApproval: boolean
}

export interface MultisigTxDetails {
  status: 'DONE' | 'FAILED' | 'PENDING' | 'CANCELLED'
  txHash?: Hash
}

export interface BaseTransaction {
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
  sendBatchTransaction?: (batchTransactions: BaseTransaction[]) => Promise<Hash>
  shouldBatchTransactions?: boolean
}
