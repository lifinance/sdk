import type { Client } from '@bigmi/core'
import type { TaskExtraBase } from '@lifi/sdk'
import type { getBitcoinPublicClient } from '../client/publicClient.js'

export interface BitcoinTaskExtra extends TaskExtraBase {
  /** Bigmi wallet client (for signing) */
  walletClient: Client

  /** Public client for sending tx and waiting (from getBitcoinPublicClient) */
  publicClient: Awaited<ReturnType<typeof getBitcoinPublicClient>>

  /** Set by BitcoinSignAndExecuteTask; consumed by BitcoinWaitForTransactionTask */
  txHex?: string
}
