import type {
  ExecutionAction,
  ExecutionOptions,
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  SignedTypedData,
  StatusManager,
} from '@lifi/sdk'
import type { Address, Client } from 'viem'
import type { Call } from '../../types.js'

export type CheckAllowanceParams = {
  checkClient(
    step: LiFiStepExtended,
    action: ExecutionAction,
    targetChainId?: number
  ): Promise<Client | undefined>
  chain: ExtendedChain
  step: LiFiStep
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  allowUserInteraction?: boolean
  permit2Supported?: boolean
  disableMessageSigning?: boolean
}

export type AllowanceResult =
  | { status: 'ACTION_REQUIRED' }
  | {
      status: 'BATCH_APPROVAL'
      data: { calls: Call[]; signedTypedData: SignedTypedData[] }
    }
  | {
      status: 'NATIVE_PERMIT' | 'DONE'
      data: SignedTypedData[]
    }

/** State passed between allowance sub-tasks. */
export interface AllowanceFlowState {
  result?: AllowanceResult
  sharedAction?: ExecutionAction
  updatedClient?: Client
  signedTypedData: SignedTypedData[]
  spenderAddress?: Address
  fromAmount?: bigint
  approved?: bigint
  shouldResetApproval?: boolean
}
