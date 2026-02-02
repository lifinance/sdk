import type {
  ExecutionAction,
  ExecutionActionType,
  ExecutionOptions,
  ExtendedChain,
  StatusManager,
} from '@lifi/sdk'
import type { Transaction } from '@solana/kit'
import type { Wallet, WalletAccount } from '@wallet-standard/base'

export interface SolanaTaskExtra {
  wallet: Wallet
  walletAccount: WalletAccount
  statusManager: StatusManager
  executionOptions?: ExecutionOptions

  fromChain: ExtendedChain
  toChain: ExtendedChain

  isBridgeExecution: boolean
  actionType: ExecutionActionType
  action: ExecutionAction

  /** Set by SolanaSignAndExecuteTask; consumed by SolanaWaitForTransactionTask */
  signedTransaction?: Transaction
}
