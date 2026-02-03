import type {
  ExecutionAction,
  LiFiStepExtended,
  SignedTypedData,
  TaskExtraBase,
  TaskPipeline,
  TransactionParameters,
} from '@lifi/sdk'
import type { Client } from 'viem'
import type { Call } from '../types.js'

export type CheckClientFn = (
  step: LiFiStepExtended,
  action: ExecutionAction,
  targetChainId?: number
) => Promise<Client | undefined>

/**
 * Execution strategy for an EVM step. Determines which pipeline of tasks runs.
 * - standard: regular approval + getStepTransaction + sendTransaction
 * - relayer: gasless execution via typed data + relayTransaction
 * - batch: EIP-5792 batched calls (approval + transfer in one sendCalls)
 */
export type EthereumExecutionStrategy = 'standard' | 'relayer' | 'batch'

export interface EthereumTaskExtra extends TaskExtraBase {
  /** Which strategy is used for this step; determines pipeline of tasks. */
  executionStrategy: EthereumExecutionStrategy

  /** Mutable. Filled by CheckAllowance (batch) and SignAndExecute (transfer call). */
  calls: Call[]
  /** Mutable. Filled by CheckAllowance (permits) and SignAndExecute (relayer). */
  signedTypedData: SignedTypedData[]

  batchingSupported: boolean
  permit2Supported: boolean

  /** Set by PrepareTransaction task. */
  transactionRequest?: TransactionParameters
  isRelayerTransaction?: boolean

  /** Viem client for signing/sending. */
  ethereumClient: Client

  /** Switch chain if needed and verify wallet; returns updated client or undefined. */
  checkClient: CheckClientFn

  pipeline: TaskPipeline

  /** Params passed when retrying executeStep (e.g. atomicityNotReady for 7702). */
  retryParams?: Record<string, unknown>
}
