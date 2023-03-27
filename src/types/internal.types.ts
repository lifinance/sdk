import { TransactionRequest } from '@ethersproject/abstract-provider'
import { Route, RouteOptions, Step, Token } from '@lifi/types'
import BigNumber from 'bignumber.js'
import { Signer } from 'ethers'
import { ChainId } from '.'
import { StatusManager } from '../execution/StatusManager'
import { StepExecutor } from '../execution/StepExecutor'

export interface TokenWithAmounts extends Token {
  amount?: BigNumber
  amountRendered?: string
}

export type ParsedReceipt = {
  fromAmount?: string
  toAmount: string
  gasUsed: string
  gasPrice: string
  gasFee: string
  toTokenAddress?: string
}

export interface ExecutionParams {
  signer: Signer
  step: Step
  statusManager: StatusManager
  settings: InternalExecutionSettings
}

export type CallbackFunction = (updatedRoute: Route) => void
export type TxRequestCallbackFunction = (
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
}

export type SwitchChainHook = (
  requiredChainId: number
) => Promise<Signer | undefined>

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
  updateCallback: CallbackFunction
  switchChainHook: SwitchChainHook
  acceptSlippageUpdateHook: AcceptSlippageUpdateHook
  acceptExchangeRateUpdateHook: AcceptExchangeRateUpdateHook
  infiniteApproval: boolean
  executeInBackground: boolean
  updateTransactionRequest?: TxRequestCallbackFunction
}

// Hard to read but this creates a new type that enforces all optional properties in a given interface
export type EnforcedObjectProperties<T> = T & {
  [P in keyof T]-?: T[P]
}

export type RouteExecutionDictionary = Partial<
  Record<string, RouteExecutionData>
>

export type RouteExecutionPromiseDictionary = Partial<
  Record<string, Promise<Route>>
>

export type RevokeTokenData = {
  token: Token
  approvalAddress: string
}

export interface InteractionSettings {
  allowInteraction?: boolean
  allowUpdates?: boolean
  stopExecution?: boolean
}
