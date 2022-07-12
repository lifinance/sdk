import {
  CrossStep,
  LifiStep,
  Route,
  RouteOptions,
  Step,
  SwapStep,
  Token,
} from '@lifi/types'
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

interface ExecutionParams {
  signer: Signer
  step: Step
  statusManager: StatusManager
  settings: InternalExecutionSettings
}

export interface ExecuteSwapParams extends ExecutionParams {
  step: SwapStep
}

export interface ExecuteCrossParams extends ExecutionParams {
  step: CrossStep | LifiStep
}

export type CallbackFunction = (updatedRoute: Route) => void

export type Config = {
  apiUrl: string
  rpcs: Record<ChainId, string[]>
  multicallAddresses: Record<ChainId, string | undefined>
  defaultExecutionSettings: InternalExecutionSettings
  defaultRouteOptions: RouteOptions
}

export type ConfigUpdate = {
  apiUrl?: string
  rpcs?: Record<number, string[]>
  multicallAddresses?: Record<number, string | undefined>
  defaultExecutionSettings?: ExecutionSettings
  defaultRouteOptions?: RouteOptions
}

export type SwitchChainHook = (
  requiredChainId: number
) => Promise<Signer | undefined>

export interface ExecutionData {
  route: Route
  executors: StepExecutor[]
  settings: InternalExecutionSettings
}

export interface ExecutionSettings {
  updateCallback?: CallbackFunction
  switchChainHook?: SwitchChainHook
  infiniteApproval?: boolean
}

export interface InternalExecutionSettings extends ExecutionSettings {
  updateCallback: CallbackFunction
  switchChainHook: SwitchChainHook
  infiniteApproval: boolean
}

// Hard to read but this creates a new type that enforces all optional properties in a given interface
export type EnforcedObjectProperties<T> = T & {
  [P in keyof T]-?: T[P]
}

export interface ActiveRouteDictionary {
  [k: string]: ExecutionData
}

export type RevokeTokenData = {
  token: Token
  approvalAddress: string
}

export interface HaltingSettings {
  allowUpdates?: boolean
}
