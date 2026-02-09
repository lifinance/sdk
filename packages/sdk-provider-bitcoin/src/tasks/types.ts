import type { Client } from '@bigmi/core'
import type { TaskExtraBase } from '@lifi/sdk'
import type { PublicClient } from '../client/publicClient.js'

export interface BitcoinTaskExtra extends TaskExtraBase {
  walletClient: Client
  publicClient: PublicClient
}
