import type { ExtendedChain, SignedTypedData } from '@lifi/types'
import type { StatusManager } from '../core/StatusManager.js'
import type { ExecuteStepRetryError } from '../errors/errors.js'
import type { SDKError } from '../errors/SDKError.js'
import type {
  ExecuteStepRetryParams,
  ExecutionAction,
  ExecutionActionType,
  ExecutionOptions,
  LiFiStepExtended,
  SDKClient,
  TransactionParameters,
} from './core.js'

/**
 * Error type used in step task execution. May carry the ExecutionAction for the task that threw,
 * so parseErrors and FAILED updates can use it. BaseStepExecutionTask attaches action from context when catching.
 */
export type StepExecutionError = Error & { action?: ExecutionAction }

/** Shared task-context extra fields; all ecosystems have these. */
export interface TaskExtraBase {
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  fromChain: ExtendedChain
  toChain: ExtendedChain
  isBridgeExecution: boolean
  pollingIntervalMs?: number
  /** Get action by type if it exists (read-only). Use in shouldRun(). */
  getAction: (type: ExecutionActionType) => ExecutionAction | undefined
  /** Get or create action by type. Use in run() when the task may update the action. */
  getOrCreateAction: (type: ExecutionActionType) => ExecutionAction
  /** True when the step action exists, is DONE, and has txHash or taskId. Use in shouldRun(): return !context.isTransactionExecuted(). */
  isTransactionExecuted: () => boolean
  /** True when the step action exists, is DONE, and has txHash or taskId. Use in shouldRun(): return !context.isTransactionExecuted(). */
  isTransactionConfirmed: () => boolean
  /** Wallet address for the current step (e.g. for balance check). Throws if not available. */
  getWalletAddress: () => string
  /** Task pipeline for this step. Ecosystems use TaskPipeline. */
  pipeline: StepExecutorPipeline
  /** Parses raw errors into SDKError; used by BaseStepExecutionTask on failure. Receives StepExecutionError (action may be on error.action). */
  parseErrors: (
    error: StepExecutionError,
    step?: LiFiStepExtended,
    action?: ExecutionAction
  ) => Promise<SDKError | ExecuteStepRetryError>
}

/** Return type of BaseStepExecutor.getBaseContext (chain info + executor state). */
export interface StepExecutorBaseContext {
  client: SDKClient
  step: LiFiStepExtended
  fromChain: ExtendedChain
  toChain: ExtendedChain
  isBridgeExecution: boolean
  getAction: (type: ExecutionActionType) => ExecutionAction | undefined
  getOrCreateAction: (type: ExecutionActionType) => ExecutionAction
  /** True when the step action exists, is DONE, and has txHash or taskId. Use in shouldRun(): return !context.isTransactionExecuted(). */
  isTransactionExecuted: () => boolean
  isTransactionConfirmed: () => boolean
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction: boolean
  retryParams?: ExecuteStepRetryParams
}

/** Return type of StepExecutor.getContext: base context + ecosystem-specific extra. */
export type StepExecutorContext<TExtra extends TaskExtraBase = TaskExtraBase> =
  StepExecutorBaseContext & TExtra

/** Base context fields provided by pipeline and executor */
export interface TaskContextBase {
  client: SDKClient
  step: LiFiStepExtended
  chain: ExtendedChain
  allowUserInteraction: boolean
  statusManager: StatusManager
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

/** Result of TaskPipeline.run() or TaskPipeline.resume(). */
export type PipelineResult =
  | { status: 'COMPLETED'; pipelineContext: PipelineContext }
  | { status: 'PAUSED'; pausedAtTask: string; pipelineContext: PipelineContext }

/** Minimal interface for context.pipeline; avoids circular dependency on TaskPipeline. */
export interface StepExecutorPipeline {
  run(context: unknown): Promise<PipelineResult>
  resume(
    savedState: PipelineSavedState,
    context: unknown
  ): Promise<PipelineResult>
}
