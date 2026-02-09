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
  TaskExecutionActionType,
} from './core.js'

interface TaskContextShared {
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  fromChain: ExtendedChain
  toChain: ExtendedChain
  isBridgeExecution: boolean
  getAction: (type: TaskExecutionActionType) => ExecutionAction | undefined
  createAction: (type: TaskExecutionActionType) => ExecutionAction
  isTransactionExecuted: (action?: ExecutionAction) => boolean
  isTransactionConfirmed: (action?: ExecutionAction) => boolean
}

export interface TaskExtraBase extends TaskContextShared {
  pollingIntervalMs?: number
  pipeline: {
    run(context: TaskContext<TaskExtraBase>): Promise<PipelineResult>
    resume(
      pausedAtTask: string,
      context: TaskContext<TaskExtraBase>
    ): Promise<PipelineResult>
  }
  parseErrors: (
    error: Error,
    step?: LiFiStepExtended,
    action?: ExecutionAction
  ) => Promise<SDKError | ExecuteStepRetryError>
}

export interface StepExecutorBaseContext extends TaskContextShared {
  client: SDKClient
  step: LiFiStepExtended
  allowUserInteraction: boolean
  retryParams?: ExecuteStepRetryParams
}

export type StepExecutorContext<TExtra extends TaskExtraBase = TaskExtraBase> =
  StepExecutorBaseContext & TExtra

export type TaskContext<TExtra extends TaskExtraBase = TaskExtraBase> =
  StepExecutorContext<TExtra>

export interface TaskResult {
  status: TaskStatus
}

export type TaskStatus = 'COMPLETED' | 'PAUSED'

export type PipelineResult =
  | { status: 'COMPLETED' }
  | { status: 'PAUSED'; pausedAtTask: string }
