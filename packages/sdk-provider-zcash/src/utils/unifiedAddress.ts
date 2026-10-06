import { blake2b } from '@noble/hashes/blake2b'
import { bech32m } from '@scure/base'

const ORCHARD = 0x03
/** Byte length of each receiver typecode the API pays to (ZIP 316). */
const RECEIVER_LENGTHS: ReadonlyMap<number, number> = new Map([
  [0x00, 20], // P2PKH
  [0x01, 20], // P2SH
  [0x02, 43], // Sapling
  [ORCHARD, 43],
])
// Bech32 caps decoding at 90 characters; a unified address runs to hundreds.
const BECH32M_LIMIT = 4096
const MIN_JUMBLED_LENGTH = 48
// The decoded payload ends with the HRP `u`, zero-padded to 16 bytes.
const PADDING = Uint8Array.from({ length: 16 }, (_, k) => (k === 0 ? 0x75 : 0))
const BLAKE2B_MAX_LENGTH = 64

const textEncoder = new TextEncoder()

/** 16-byte BLAKE2b personalization: `UA_F4Jumble_<tag>`, then `i` and `j` as LE u16. */
const personalization = (tag: 'H' | 'G', i: number, j = 0): Uint8Array => {
  const bytes = new Uint8Array(16)
  bytes.set(textEncoder.encode(`UA_F4Jumble_${tag}`))
  bytes[13] = i
  bytes[14] = j & 0xff
  bytes[15] = j >> 8
  return bytes
}

const hashH = (i: number, input: Uint8Array, length: number): Uint8Array =>
  blake2b(input, { dkLen: length, personalization: personalization('H', i) })

const hashG = (i: number, input: Uint8Array, length: number): Uint8Array => {
  const output = new Uint8Array(length)
  for (let j = 0; j * BLAKE2B_MAX_LENGTH < length; j++) {
    const block = blake2b(input, {
      dkLen: BLAKE2B_MAX_LENGTH,
      personalization: personalization('G', i, j),
    })
    const offset = j * BLAKE2B_MAX_LENGTH
    output.set(block.subarray(0, length - offset), offset)
  }
  return output
}

const xor = (a: Uint8Array, b: Uint8Array): Uint8Array =>
  a.map((byte, k) => byte ^ b[k])

/** The inverse of F4Jumble, the Feistel jumble ZIP 316 applies before Bech32m. */
export const f4JumbleInverse = (jumbled: Uint8Array): Uint8Array => {
  const leftLength = Math.min(
    BLAKE2B_MAX_LENGTH,
    Math.floor(jumbled.length / 2)
  )
  const rightLength = jumbled.length - leftLength
  const c = jumbled.subarray(0, leftLength)
  const d = jumbled.subarray(leftLength)
  const y = xor(c, hashH(1, d, leftLength))
  const x = xor(d, hashG(1, y, rightLength))
  const a = xor(y, hashH(0, x, leftLength))
  const b = xor(x, hashG(0, a, rightLength))
  const raw = new Uint8Array(jumbled.length)
  raw.set(a)
  raw.set(b, leftLength)
  return raw
}

/**
 * The typecodes of a decoded receiver list, or `undefined` when a receiver is
 * not one the API pays to, has another length, breaks the ascending order or
 * overruns. Every accepted typecode and length fits one CompactSize byte, so a
 * wider CompactSize can only encode a typecode the API refuses.
 */
const receiverTypecodes = (body: Uint8Array): number[] | undefined => {
  const typecodes: number[] = []
  for (let offset = 0; offset < body.length; ) {
    const typecode = body[offset]
    const length = RECEIVER_LENGTHS.get(typecode)
    const end = offset + 2 + (length ?? 0)
    if (
      length === undefined ||
      body[offset + 1] !== length ||
      end > body.length ||
      typecode <= (typecodes.at(-1) ?? -1)
    ) {
      return undefined
    }
    typecodes.push(typecode)
    offset = end
  }
  return typecodes
}

/**
 * Whether `address` is a mainnet unified address (`u1`) that the API pays to a
 * shielded balance. It must decode — Bech32m checksum, F4Jumble, padding —
 * into P2PKH, P2SH, Sapling and Orchard receivers only, each at its length, in
 * ascending typecode order, with at most one transparent receiver, and one of
 * them must be Orchard: without it a bridge pays the transparent receiver.
 */
export const isOrchardUnifiedAddress = (address: string): boolean => {
  // The API takes the lowercase form only.
  if (!address.startsWith('u1')) {
    return false
  }
  const decoded = bech32m.decodeUnsafe(address, BECH32M_LIMIT)
  if (decoded?.prefix !== 'u') {
    return false
  }
  const jumbled = bech32m.fromWordsUnsafe(decoded.words)
  if (!jumbled || jumbled.length < MIN_JUMBLED_LENGTH) {
    return false
  }
  const raw = f4JumbleInverse(jumbled)
  const paddingStart = raw.length - PADDING.length
  if (PADDING.some((byte, k) => raw[paddingStart + k] !== byte)) {
    return false
  }
  const typecodes = receiverTypecodes(raw.subarray(0, paddingStart)) ?? []
  return (
    typecodes.includes(ORCHARD) &&
    !(typecodes.includes(0x00) && typecodes.includes(0x01))
  )
}
