import type { SDKClient } from '@lifi/sdk'
import type { Address, Client } from 'viem'
import { isSafeWallet } from './isSafeWallet.js'

export interface IsSafeSignatureProps {
  hash: string
  chainId: number
  address?: Address
  viemClient?: Client
}

/**
 * Check if a transaction response is a Safe wallet signature (queued transaction)
 *
 * Safe wallets via Rabby return a signature (65 bytes = 132 chars) instead of
 * a transaction hash (32 bytes = 66 chars) for queued transactions.
 */
export async function isSafeSignature(
  client: SDKClient,
  { hash, chainId, address, viemClient }: IsSafeSignatureProps
): Promise<boolean> {
  // Signature: 65 bytes = 130 hex chars + 0x prefix = 132 chars
  // Tx hash: 32 bytes = 64 hex chars + 0x prefix = 66 chars
  if (!hash.startsWith('0x') || hash.length <= 66) {
    return false
  }

  if (!address) {
    return false
  }

  return isSafeWallet(client, { chainId, address, viemClient })
}
