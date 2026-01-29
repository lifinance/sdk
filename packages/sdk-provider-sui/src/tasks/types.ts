import type {
  ExecutionAction,
  ExecutionActionType,
  ExecutionOptions,
  ExtendedChain,
  StatusManager,
} from '@lifi/sdk'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'

export interface SuiTaskExtra {
  wallet: WalletWithRequiredFeatures
  statusManager: StatusManager
  executionOptions?: ExecutionOptions

  fromChain: ExtendedChain
  toChain: ExtendedChain

  isBridgeExecution: boolean
  actionType: ExecutionActionType
  action: ExecutionAction
}
