import type { ExtendedChain, SignedTypedData } from '@lifi/types'
import type { StatusManager } from '../core/StatusManager.js'
import type {
  ExecuteStepRetryParams,
  ExecutionAction,
  ExecutionActionType,
  ExecutionOptions,
  LiFiStepExtended,
  SDKClient,
  TransactionParameters,
} from './core.js'

/** Shared task-context extra fields; all ecosystems have these. */
export interface TaskExtraBase {
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  fromChain: ExtendedChain
  toChain: ExtendedChain
  isBridgeExecution: boolean
  actionType: ExecutionActionType
  action: ExecutionAction
  /** Task pipeline for this step. Typed as unknown to avoid circular import; ecosystems use TaskPipeline. */
  pipeline: unknown
}

/** Return type of BaseStepExecutor.getBaseContext (chain info + executor state). */
export interface StepExecutorBaseContext {
  client: SDKClient
  step: LiFiStepExtended
  fromChain: ExtendedChain
  toChain: ExtendedChain
  isBridgeExecution: boolean
  actionType: ExecutionActionType
  action: ExecutionAction
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction: boolean
  retryParams?: ExecuteStepRetryParams
}

/** Base context fields provided by pipeline and executor */
export interface TaskContextBase {
  client: SDKClient
  step: LiFiStepExtended
  chain: ExtendedChain
  allowUserInteraction: boolean
  /** Results from previous tasks in pipeline */
  pipelineContext: PipelineContext
}

/** Context = base fields + ecosystem-specific fields at top level */
export type TaskContext<TExtra = unknown> = TaskContextBase & TExtra

export interface TaskResult<T = unknown> {
  status: TaskStatus
  data?: T

  /** State to save for resumability */
  saveState?: TaskState
}

export type TaskStatus = 'COMPLETED' | 'PAUSED' | 'SKIPPED'

/**
 * Optional state a task can return when pausing. Pipeline only uses pausedAtTask
 * and pipelineContext on resume; taskState is stored but not read (resume = re-execute).
 * taskType is the task identifier; phase and data are optional for debugging/future use.
 */
export interface TaskState {
  taskType: string
  phase?: string
  data?: Record<string, unknown>
}

export interface PipelineContext {
  /** Accumulated data from all completed tasks */
  [key: string]: unknown

  // Common fields that tasks might contribute
  signedPermits?: SignedTypedData[]
  batchCalls?: Record<string, unknown>[]
  preparedTransaction?: TransactionParameters
}

/**
 * State persisted when a task pipeline pauses (e.g. for user interaction).
 * Stored on step.execution.pipelineSavedState so the executor can call pipeline.resume() on the next run.
 */
export interface PipelineSavedState {
  pausedAtTask: string
  pipelineContext: PipelineContext
}
