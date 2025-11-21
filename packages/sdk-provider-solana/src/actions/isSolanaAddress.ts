import { isAddress } from '@solana/kit'

export function isSolanaAddress(address: string): boolean {
  return isAddress(address)
}
