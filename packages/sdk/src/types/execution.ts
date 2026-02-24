import type { ExtendedChain } from '@lifi/types'
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
}

export interface StepExecutorContext extends StepExecutorBaseContext {
  pollingIntervalMs?: number
  parseErrors: (
    error: Error,
    step?: LiFiStepExtended,
    action?: ExecutionAction
  ) => Promise<SDKError | ExecuteStepRetryError>
  /**
   * Accumulated results from previous tasks. Only the pipeline writes to this;
   * tasks should only read. Providers extend the type for their result keys.
   */
  tasksResults: Record<string, unknown>
}

export type TaskResultData = Record<string, unknown>

export interface TaskResult {
  status: TaskStatus
  /** Optional: data produced for downstream tasks. Pipeline merges into context.tasksResults. */
  result?: TaskResultData
}

export type TaskStatus = 'COMPLETED' | 'PAUSED'
