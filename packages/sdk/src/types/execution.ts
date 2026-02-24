import type { ExtendedChain, StatusResponse } from '@lifi/types'
import type { StatusManager } from '../core/StatusManager.js'
import type { ExecuteStepRetryError } from '../errors/errors.js'
import type { SDKError } from '../errors/SDKError.js'
import type {
  ExecuteStepRetryParams,
  ExecutionAction,
  ExecutionOptions,
  LiFiStepExtended,
  SDKClient,
} from './core.js'

export interface StepExecutorBaseContext {
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  fromChain: ExtendedChain
  toChain: ExtendedChain
  isBridgeExecution: boolean
  client: SDKClient
  step: LiFiStepExtended
  allowUserInteraction: boolean
  retryParams?: ExecuteStepRetryParams
  /** Request-scoped cache for transaction status polling (keyed by txHash). */
  transactionStatusObservers?: Record<string, Promise<StatusResponse>>
}

export interface StepExecutorContext extends StepExecutorBaseContext {
  pollingIntervalMs?: number
  firstTaskName: string
  pipeline: {
    run(context: StepExecutorContext): Promise<TaskResult>
  }
  parseErrors: (
    error: Error,
    step?: LiFiStepExtended,
    action?: ExecutionAction
  ) => Promise<SDKError | ExecuteStepRetryError>
  /**
   * Accumulated outputs from previous tasks. Only the pipeline writes to this;
   * tasks should only read. Providers extend the type for their output keys.
   */
  outputs: Record<string, unknown>
}

export type TaskOutput = Record<string, unknown>

export interface TaskResult {
  status: TaskStatus
  /** Optional: data produced for downstream tasks. Pipeline merges into context.outputs. */
  output?: TaskOutput
}

export type TaskStatus = 'COMPLETED' | 'PAUSED'
