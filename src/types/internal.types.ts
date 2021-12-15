import {
  CrossStep,
  Execution,
  LifiStep,
  Route,
  RouteOptions,
  Step,
  SwapStep,
  Token,
} from '@lifinance/types'
import BigNumber from 'bignumber.js'
import { Signer } from 'ethers'
import { ChainId } from '.'
import { StepExecutor } from '../executionFiles/StepExecutor'

export interface TokenWithAmounts extends Token {
  amount?: BigNumber
  amountRendered?: string
}

export interface ProgressStep {
  title: string
  description: string
}

export type ParsedReceipt = {
  fromAmount: string
  toAmount: string
  gasUsed: string
  gasPrice: string
  gasFee: string
}

export type ExecuteSwapParams = {
  signer: Signer
  step: SwapStep
  parseReceipt: (...args: any[]) => ParsedReceipt
  updateStatus?: UpdateExecution
}

export type ExecuteCrossParams = {
  signer: Signer
  step: CrossStep | LifiStep
  updateStatus?: UpdateExecution
  hooks: Hooks
}

export type UpdateStep = (step: Step, execution: Execution) => void
export type UpdateExecution = (execution: Execution) => void
export type CallbackFunction = (updatedRoute: Route) => void

export type Config = {
  apiUrl: string
  rpcs: Record<ChainId, string[]>
  multicallAddresses: Record<ChainId, string | undefined>
  defaultExecutionSettings: Hooks
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

export type GetPublicKeyHook = () => Promise<string | undefined>
export type DecryptHook = (data: string) => Promise<string>
export interface ExecutionData {
  route: Route
  executors: StepExecutor[]
  settings: Hooks
}

export interface ExecutionSettings {
  getPublicKeyHook?: GetPublicKeyHook
  decryptHook?: DecryptHook
  updateCallback?: CallbackFunction
  switchChainHook?: SwitchChainHook
}

export interface Hooks extends ExecutionSettings {
  updateCallback: CallbackFunction
  switchChainHook: SwitchChainHook
}

// Hard to read but this creates a new type that enforces all optional properties in a given interface
export type EnforcedObjectProperties<T> = T & {
  [P in keyof T]-?: T[P]
}
export interface ActiveRouteDictionary {
  [k: string]: ExecutionData
}
