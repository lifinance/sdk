import type {
  ExecutionAction,
  ExecutionActionType,
  ExecutionOptions,
  ExtendedChain,
  SignedTypedData,
  StatusManager,
  TransactionParameters,
} from '@lifi/sdk'
import type { Client } from 'viem'
import type { Call } from '../types.js'
import type { CheckClientDeps } from './helpers/checkClient.js'

export interface EthereumTaskExtra {
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  fromChain: ExtendedChain
  toChain: ExtendedChain
  isBridgeExecution: boolean
  actionType: ExecutionActionType
  action: ExecutionAction

  /** Mutable. Filled by CheckAllowance (batch) and SignAndExecute (transfer call). */
  calls: Call[]
  /** Mutable. Filled by CheckAllowance (permits) and SignAndExecute (relayer). */
  signedTypedData: SignedTypedData[]

  batchingSupported: boolean
  permit2Supported: boolean
  disableMessageSigning: boolean

  /** Set by PrepareTransaction task. */
  transactionRequest?: TransactionParameters
  isRelayerTransaction?: boolean

  /** Viem client for signing/sending. */
  ethereumClient: Client

  /** Params for checkClient helper (tasks import helper and pass this). */
  checkClientDeps: CheckClientDeps
}
