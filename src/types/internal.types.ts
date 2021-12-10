/* eslint-disable @typescript-eslint/no-empty-function */
import {
  CrossStep,
  Execution,
  LifiStep,
  Route,
  Step,
  SwapStep,
  Token,
} from '@lifinance/types'
import BigNumber from 'bignumber.js'
import { Signer } from 'ethers'
import { StatusManager } from '..'
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
  settings: EnforcedObjectProperties<ExecutionSettings>
  statusManager: StatusManager
}

export type ExecuteCrossParams = {
  signer: Signer
  step: CrossStep | LifiStep
  settings: EnforcedObjectProperties<ExecutionSettings>
  statusManager: StatusManager
}

export type UpdateStep = (step: Step, execution: Execution) => void
export type UpdateExecution = (execution: Execution) => void
export type CallbackFunction = (updatedRoute: Route) => void
export type SwitchChainHook = (
  requiredChainId: number
) => Promise<Signer | undefined>

export interface ExecutionData {
  route: Route
  executors: StepExecutor[]
  settings: EnforcedObjectProperties<ExecutionSettings>
}

export const DefaultExecutionSettings = {
  updateCallback: () => {},
  switchChainHook: () => new Promise<undefined>(() => {}),
}

export interface ExecutionSettings {
  updateCallback?: CallbackFunction
  switchChainHook?: SwitchChainHook
}

// Hard to read but this creates a new type that enforces all optional properties in a given interface
export type EnforcedObjectProperties<T> = T & {
  [P in keyof T]-?: T[P]
}
export interface ActiveRouteDictionary {
  [k: string]: ExecutionData
}
