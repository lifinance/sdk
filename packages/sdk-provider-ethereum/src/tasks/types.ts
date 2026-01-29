import type {
  ExecutionAction,
  ExecutionActionType,
  ExecutionOptions,
  ExtendedChain,
  LiFiStepExtended,
  SignedTypedData,
  StatusManager,
  TransactionParameters,
} from '@lifi/sdk'
import type { Client } from 'viem'
import type { Call } from '../types.js'

export type CheckClientFn = (
  step: LiFiStepExtended,
  action: ExecutionAction,
  targetChainId?: number
) => Promise<Client | undefined>

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

  /** Switch chain if needed and verify wallet; returns updated client or undefined. */
  checkClient: CheckClientFn
}
