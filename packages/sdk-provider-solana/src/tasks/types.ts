import type { TaskExtraBase, TaskPipeline } from '@lifi/sdk'
import type { Transaction } from '@solana/kit'
import type { Wallet, WalletAccount } from '@wallet-standard/base'

export interface SolanaTaskExtra extends TaskExtraBase {
  wallet: Wallet
  walletAccount: WalletAccount

  /** Set by SolanaSignAndExecuteTask; consumed by SolanaWaitForTransactionTask */
  signedTransaction?: Transaction

  pipeline: TaskPipeline
}
