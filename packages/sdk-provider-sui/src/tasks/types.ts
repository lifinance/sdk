import type { TaskExtraBase } from '@lifi/sdk'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'

export interface SuiTaskExtra extends TaskExtraBase {
  wallet: WalletWithRequiredFeatures
}
