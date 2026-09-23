import { sha256 } from '@noble/hashes/sha2'
import { createBase58check } from '@scure/base'
import { type BechLib, bech32, bech32m } from 'bech32'

/** The mainnet Zcash address kinds, named by the receiver they encode. */
export type ZcashAddressKind = 'p2pkh' | 'p2sh' | 'tex' | 'sapling' | 'unified'

/**
 * The kinds a LI.FI route may send to. The API handles transparent receivers
 * only; add a kind here once the backend confirms it.
 */
export const acceptedZcashAddressKinds: ReadonlySet<ZcashAddressKind> =
  new Set<ZcashAddressKind>(['p2pkh', 'p2sh'])

// Unified addresses outgrow Bech32's default 90-character limit: the longest
// official test vector (zcash-test-vectors, unified_address.json) has 509.
const bech32LengthLimit = 1024

// A transparent address decodes to a 2-byte version prefix and a 20-byte hash.
const transparentPayloadLength = 22

const base58check = createBase58check(sha256)

/** The payload of a Base58Check string, or `undefined` for a bad checksum or alphabet. */
const decodeBase58check = (value: string): Uint8Array | undefined => {
  try {
    return base58check.decode(value)
  } catch {
    return undefined
  }
}

const parseTransparentAddress = (
  address: string
): ZcashAddressKind | undefined => {
  const payload = decodeBase58check(address)
  if (payload?.length !== transparentPayloadLength || payload[0] !== 0x1c) {
    return undefined
  }
  if (payload[1] === 0xb8) {
    return 'p2pkh'
  }
  if (payload[1] === 0xbd) {
    return 'p2sh'
  }
  return undefined
}

interface Bech32Kind {
  kind: ZcashAddressKind
  prefix: string
  encoding: BechLib
  /** Unified addresses are F4Jumbled, so only their checksum is checked. */
  payloadLength?: number
}

const bech32Kinds: Bech32Kind[] = [
  { kind: 'tex', prefix: 'tex', encoding: bech32m, payloadLength: 20 },
  { kind: 'sapling', prefix: 'zs', encoding: bech32, payloadLength: 43 },
  { kind: 'unified', prefix: 'u', encoding: bech32m },
]

const parseBech32Address = (address: string): ZcashAddressKind | undefined =>
  bech32Kinds.find(({ prefix, encoding, payloadLength }) => {
    const decoded = encoding.decodeUnsafe(address, bech32LengthLimit)
    if (decoded?.prefix !== prefix) {
      return false
    }
    const payload = encoding.fromWordsUnsafe(decoded.words)
    return (
      payload !== undefined &&
      (payloadLength === undefined || payload.length === payloadLength)
    )
  })?.kind

/**
 * Decodes a mainnet Zcash address and verifies its checksum. A testnet address,
 * or any other version or prefix, returns `undefined`.
 */
export const parseZcashAddress = (
  address: string
): ZcashAddressKind | undefined =>
  parseTransparentAddress(address) ?? parseBech32Address(address)

/** Whether `address` is a Zcash address a LI.FI route may send to. */
export const isZcashAddress = (address: string): boolean => {
  const kind = parseZcashAddress(address)
  return kind !== undefined && acceptedZcashAddressKinds.has(kind)
}
