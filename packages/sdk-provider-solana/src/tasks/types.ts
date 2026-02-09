import type { TaskExtraBase } from '@lifi/sdk'
import type { Wallet, WalletAccount } from '@wallet-standard/base'

export interface SolanaTaskExtra extends TaskExtraBase {
  wallet: Wallet
  walletAccount: WalletAccount
}
