import type { ExtendedChain, SignedTypedData } from '@lifi/types'
import type {
  LiFiStepExtended,
  SDKClient,
  TransactionParameters,
} from './core.js'

/**
 * A task is a discrete unit of work that may require user interaction.
 * Tasks are composable and can be chained in a pipeline.
 */
export interface ExecutionTask<TContext = unknown, TResult = unknown> {
  /** Unique identifier for this task type */
  readonly type: string

  /** Human-readable name for display */
  readonly displayName: string

  /**
   * Check if this task needs to run.
   * Return false to skip entirely.
   */
  shouldRun(context: TaskContext<TContext>): Promise<boolean>

  /**
   * Execute the task.
   * Can yield for user actions (signatures, confirmations).
   * Returns result that's passed to subsequent tasks.
   */
  execute(context: TaskContext<TContext>): Promise<TaskResult<TResult>>
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
