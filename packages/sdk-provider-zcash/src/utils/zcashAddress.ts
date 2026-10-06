import { sha256 } from '@noble/hashes/sha2'
import { createBase58check } from '@scure/base'
import { isOrchardUnifiedAddress } from './unifiedAddress.js'

const base58check = createBase58check(sha256)

const isTransparentZcashAddress = (address: string): boolean => {
  let payload: Uint8Array
  try {
    payload = base58check.decode(address)
  } catch {
    return false
  }
  // A 2-byte version prefix (0x1CB8 or 0x1CBD) and a 20-byte hash.
  return (
    payload.length === 22 &&
    payload[0] === 0x1c &&
    (payload[1] === 0xb8 || payload[1] === 0xbd)
  )
}

/**
 * Whether `address` is a mainnet Zcash address the API pays to: a transparent
 * `t1` (P2PKH) or `t3` (P2SH) address with a valid checksum, or a unified `u1`
 * address with an Orchard receiver. Sapling, TEX and testnet addresses, and a
 * unified address without an Orchard receiver, return `false`.
 */
export const isZcashAddress = (address: string): boolean =>
  isTransparentZcashAddress(address) || isOrchardUnifiedAddress(address)
