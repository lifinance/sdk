import type {
  ExecutionAction,
  LiFiStepExtended,
  TaskExtraBase,
} from '@lifi/sdk'
import type { Client } from 'viem'

/**
 * Execution strategy for an EVM step. Determines which pipeline of tasks runs.
 * - standard: regular approval + getStepTransaction + sendTransaction
 * - relayer: gasless execution via typed data + relayTransaction
 * - batch: EIP-5792 batched calls (approval + transfer in one sendCalls)
 */
export type EthereumExecutionStrategy = 'standard' | 'relayer' | 'batch'

export interface EthereumTaskExtra extends TaskExtraBase {
  getExecutionStrategy: (
    step: LiFiStepExtended
  ) => Promise<EthereumExecutionStrategy>
  /** Viem client for signing/sending. */
  ethereumClient: Client
  checkClient: (
    step: LiFiStepExtended,
    action: ExecutionAction,
    targetChainId?: number
  ) => Promise<Client | undefined>
  switchChain?: (chainId: number) => Promise<Client | undefined>
  /** Params passed when retrying executeStep (e.g. atomicityNotReady for 7702). */
  retryParams?: Record<string, unknown>
}
