import { PublicKey } from '@solana/web3.js'

export function isAddress(address: string): boolean {
  try {
    new PublicKey(address)
    return true
  } catch (error) {
    return false
  }
}
