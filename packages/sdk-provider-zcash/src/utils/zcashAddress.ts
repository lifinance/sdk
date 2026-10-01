import { sha256 } from '@noble/hashes/sha2'
import { createBase58check } from '@scure/base'

const base58check = createBase58check(sha256)

/**
 * Whether `address` is a mainnet transparent Zcash address (`t1` P2PKH or `t3`
 * P2SH) with a valid checksum. The API handles transparent receivers only, so
 * TEX, Sapling and unified addresses, and testnet forms, return `false`.
 */
export const isZcashAddress = (address: string): boolean => {
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
