import type { Client } from '@bigmi/core'
import type {
  ExecutionAction,
  ExecutionActionType,
  ExecutionOptions,
  ExtendedChain,
  StatusManager,
} from '@lifi/sdk'
import type { getBitcoinPublicClient } from '../client/publicClient.js'

export interface BitcoinTaskExtra {
  /** Bigmi wallet client (for signing) */
  walletClient: Client
  statusManager: StatusManager
  executionOptions?: ExecutionOptions

  fromChain: ExtendedChain
  toChain: ExtendedChain

  isBridgeExecution: boolean
  actionType: ExecutionActionType
  action: ExecutionAction

  /** Public client for sending tx and waiting (from getBitcoinPublicClient) */
  publicClient: Awaited<ReturnType<typeof getBitcoinPublicClient>>
}
