import type { LifiStep, Route, RouteOptions, Token } from '@lifi/types'
import type { Hash, Hex, WalletClient } from 'viem'
import type { ChainId } from '.'
import type { StatusManager } from '../execution/StatusManager'
import type { StepExecutor } from '../execution/StepExecutor'

export type TransactionRequest = {
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

export interface ExecutionParams {
  walletClient: WalletClient
  step: LifiStep
  statusManager: StatusManager
  settings: InternalExecutionSettings
}

export type UpdateRouteHook = (updatedRoute: Route) => void
export type TransactionRequestUpdateHook = (
  updatedTxRequest: TransactionRequest
) => Promise<TransactionRequest>

export type Config = {
  apiUrl: string
  rpcs: Record<ChainId, string[]>
  multicallAddresses: Record<ChainId, string | undefined>
  defaultExecutionSettings: InternalExecutionSettings
  defaultRouteOptions: RouteOptions
  disableVersionCheck?: boolean
  userId?: string
  integrator: string
  widgetVersion?: string
  multisig?: MultisigConfig
}

export interface MultisigTxDetails {
  status: 'DONE' | 'FAILED' | 'PENDING' | 'CANCELLED'
  txHash?: Hash
}

export interface MultisigTransactionResponse {
  hash: string
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

export type ConfigUpdate = {
  apiUrl?: string
  rpcs?: Record<number, string[]>
  multicallAddresses?: Record<number, string | undefined>
  defaultExecutionSettings?: ExecutionSettings
  defaultRouteOptions?: RouteOptions
  disableVersionCheck?: boolean
  userId?: string
  integrator: string
  widgetVersion?: string
  multisigConfig?: MultisigConfig
}

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

export interface RouteExecutionData {
  route: Route
  executors: StepExecutor[]
  settings: InternalExecutionSettings
}

export type ExecutionSettings = Partial<InternalExecutionSettings>

export interface InternalExecutionSettings {
  acceptExchangeRateUpdateHook: AcceptExchangeRateUpdateHook
  switchChainHook: SwitchChainHook
  updateRouteHook: UpdateRouteHook
  updateTransactionRequestHook?: TransactionRequestUpdateHook
  executeInBackground: boolean
  infiniteApproval: boolean
}

export type RouteExecutionDictionary = Partial<
  Record<string, RouteExecutionData>
>

export type RouteExecutionPromiseDictionary = Partial<
  Record<string, Promise<Route>>
>

export interface InteractionSettings {
  allowInteraction?: boolean
  allowUpdates?: boolean
  stopExecution?: boolean
}

export interface TenderlyResponse {
  hash: string
  block_hash: string
  block_number: number
  from: string
  gas: number
  gas_price: number
  gas_fee_cap: number
  gas_tip_cap: number
  cumulative_gas_used: number
  gas_used: number
  effective_gas_price: number
  input: string
  nonce: number
  to: string
  index: number
  value: string
  access_list: any
  status: boolean
  addresses: string[]
  contract_ids: string[]
  network_id: string
  timestamp: string
  function_selector: string
  l1_block_number: number
  l1_timestamp: number
  deposit_tx: boolean
  system_tx: boolean
  mint: number
  sig: Signature
  error_message: string
  method: string
  decoded_input: any
  call_trace: any
}

export interface Signature {
  v: string
  r: string
  s: string
}
