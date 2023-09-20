import type {
  ChainType,
  LiFiStep,
  Route,
  Token,
  TokenAmount,
} from '@lifi/types'
import type { Hex, WalletClient } from 'viem'

export interface SDKProvider {
  readonly type: ChainType
  isAddress(address: string): boolean
  getStepExecutor(options: StepExecutorOptions): Promise<StepExecutor>
  getBalance(walletAddress: string, tokens: Token[]): Promise<TokenAmount[]>
}

export interface StepExecutorOptions {
  routeId: string
  executionOptions?: ExecutionOptions
}

export interface InteractionSettings {
  allowInteraction?: boolean
  allowUpdates?: boolean
  allowExecution?: boolean
}

export interface StepExecutor {
  allowUserInteraction: boolean
  allowExecution: boolean
  setInteraction(settings?: InteractionSettings): void
  executeStep(step: LiFiStep): Promise<LiFiStep>
}

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

export interface RouteExecutionData {
  route: Route
  executors: StepExecutor[]
  executionOptions?: ExecutionOptions
}

export type RouteExecutionDataDictionary = Partial<
  Record<string, RouteExecutionData>
>

export type RouteExecutionDictionary = Partial<Record<string, Promise<Route>>>

export type UpdateRouteHook = (updatedRoute: Route) => void

export interface TransactionRequestParameters extends TransactionParameters {
  requestType: 'approve' | 'transaction'
}

export type TransactionRequestUpdateHook = (
  updatedTxRequest: TransactionRequestParameters
) => Promise<TransactionParameters>

export type SwitchChainHook = (
  chainId: number
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

export interface ExecutionOptions {
  acceptExchangeRateUpdateHook?: AcceptExchangeRateUpdateHook
  switchChainHook?: SwitchChainHook
  updateRouteHook?: UpdateRouteHook
  updateTransactionRequestHook?: TransactionRequestUpdateHook
  executeInBackground?: boolean
  infiniteApproval?: boolean
}
