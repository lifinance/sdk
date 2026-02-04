import type {
  SignedTypedData,
  TaskExtraBase,
  TransactionParameters,
} from '@lifi/sdk'
import type { Client } from 'viem'
import type { Call } from '../types.js'

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

  /** Mutable. Initialized and filled by allowance/sign-and-execute tasks when needed. */
  calls?: Call[]
  /** Mutable. Initialized and filled by allowance/sign-and-execute tasks when needed. */
  signedTypedData?: SignedTypedData[]

  /** Set by PrepareTransaction task. */
  transactionRequest?: TransactionParameters
  isRelayerTransaction?: boolean

  /** Viem client for signing/sending. */
  ethereumClient: Client

  getClient: () => Client
  setClient: (client: Client) => void
  switchChain?: (chainId: number) => Promise<Client | undefined>

  /** Params passed when retrying executeStep (e.g. atomicityNotReady for 7702). */
  retryParams?: Record<string, unknown>
}
