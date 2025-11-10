import { isAddress } from '@solana/kit'

export function isSVMAddress(address: string): boolean {
  return isAddress(address)
}
