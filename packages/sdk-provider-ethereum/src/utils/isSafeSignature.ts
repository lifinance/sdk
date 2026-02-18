import type { Address, Client } from 'viem'
import { isSafeWallet } from '../client/safeClient.js'

/**
 * Check if a transaction response is a Safe wallet signature (queued transaction)
 *
 * Safe wallets via Rabby return a signature (65 bytes = 132 chars) instead of
 * a transaction hash (32 bytes = 66 chars) for queued transactions.
 */
export async function isSafeSignature(
  hash: string,
  options: {
    chainId: number
    address?: Address
    safeApiKey?: string
    viemClient?: Client
  }
): Promise<boolean> {
  const { chainId, address, safeApiKey, viemClient } = options
  // Signature: 65 bytes = 130 hex chars + 0x prefix = 132 chars
  // Tx hash: 32 bytes = 64 hex chars + 0x prefix = 66 chars
  if (!hash.startsWith('0x') || hash.length <= 66) {
    return false
  }

  if (!address) {
    return false
  }

  return isSafeWallet(chainId, address, safeApiKey, viemClient)
}
