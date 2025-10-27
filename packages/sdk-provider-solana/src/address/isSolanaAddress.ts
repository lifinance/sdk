import { PublicKey } from '@solana/web3.js'

export function isSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address)
    return true
  } catch (_error) {
    return false
  }
}
