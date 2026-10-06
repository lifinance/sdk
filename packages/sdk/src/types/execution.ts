import type { ExtendedChain } from '@lifi/types'
import type { StatusManager } from '../core/StatusManager.js'
import type {
  ExecuteStepRetryParams,
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
  /**
   * Aborts when `stopRouteExecution` stops the execution. Give it only to a
   * wait that starts after the transaction is broadcast, such as the
   * `/status` poll. Never give it to a sign, send or wallet call: a stopped
   * run must finish those, so its late transaction data still reaches the
   * stored route and a resume does not sign again.
   */
  signal?: AbortSignal
}

export interface StepExecutorContext extends StepExecutorBaseContext {
  pollingIntervalMs?: number
}

export interface TaskResult<TContext = Record<string, unknown>> {
  status: TaskStatus
  /** Optional: data produced for downstream tasks. Pipeline merges into the executor context. */
  context?: TContext
}

export type TaskStatus = 'COMPLETED' | 'PAUSED'
