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
  isTransactionPrepared: (action?: ExecutionAction) => boolean
  isTransactionPending: (action?: ExecutionAction) => boolean
  client: SDKClient
  step: LiFiStepExtended
  allowUserInteraction: boolean
  retryParams?: ExecuteStepRetryParams
  /** Request-scoped cache for transaction status polling (keyed by txHash). */
  transactionStatusObservers?: Record<string, Promise<StatusResponse>>
}

export interface StepExecutorContext extends StepExecutorBaseContext {
  pollingIntervalMs?: number
  actionPipelines: {
    run(context: StepExecutorContext): Promise<TaskResult>
  }
  parseErrors: (
    error: Error,
    step?: LiFiStepExtended,
    action?: ExecutionAction
  ) => Promise<SDKError | ExecuteStepRetryError>
}

export interface TaskResult {
  status: TaskStatus
}

export type TaskStatus = 'COMPLETED' | 'ACTION_REQUIRED'
