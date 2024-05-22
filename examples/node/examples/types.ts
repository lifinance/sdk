import type { PublicActions, WalletClient } from 'viem'

export interface WalletClientWithPublicActions
  extends WalletClient,
    PublicActions {}
