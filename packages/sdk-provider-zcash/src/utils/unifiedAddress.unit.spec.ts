import { bech32m } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { f4JumbleInverse, isOrchardUnifiedAddress } from './unifiedAddress.js'
import {
  f4JumbleVectors,
  unifiedAddressVectors,
} from './unifiedAddress.vectors.mock.js'

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))

// A Zashi address with one receiver, Orchard.
const orchardOnly =
  'u1k9eh52jx5q4y8lw6x208lsep4t6yzwk7mdwz9e6239qywjkqzdcd3al3d64zwnqx296p3klxnash5w2e0elg39qrydxx0s0qz5m2gnt0'

describe('f4JumbleInverse', () => {
  it.each(f4JumbleVectors)('restores %s', (raw, jumbled) => {
    expect(f4JumbleInverse(hexToBytes(jumbled))).toEqual(hexToBytes(raw))
  })
})

describe('isOrchardUnifiedAddress', () => {
  it('accepts a unified address with an Orchard receiver only', () => {
    expect(isOrchardUnifiedAddress(orchardOnly)).toBe(true)
  })

  it.each(unifiedAddressVectors)(
    'answers $payable for $address',
    ({ address, payable }) => {
      expect(isOrchardUnifiedAddress(address)).toBe(payable)
    }
  )

  it('refuses a corrupted checksum', () => {
    // The last character of the address is `0`; `q` keeps the Bech32 alphabet.
    expect(isOrchardUnifiedAddress(`${orchardOnly.slice(0, -1)}q`)).toBe(false)
  })

  it('refuses the uppercase form, which the API does not take', () => {
    expect(isOrchardUnifiedAddress(orchardOnly.toUpperCase())).toBe(false)
  })

  it('refuses a testnet unified address', () => {
    const { words } = bech32m.decode(orchardOnly, 4096)
    expect(isOrchardUnifiedAddress(bech32m.encode('utest', words, 4096))).toBe(
      false
    )
  })

  it.each([
    ['a transparent address', 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC'],
    [
      'a Sapling address',
      'zs1mrhc9y7jdh5r9ece8u5khgvj9kg0zgkxzdduyv0whkg7lkcrkx5xqem3e48avjq9wn2rukydkwn',
    ],
    ['a TEX address', 'tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte'],
    ['a truncated address', orchardOnly.slice(0, 40)],
    ['a name', 'u1.eth'],
    ['an empty string', ''],
  ])('refuses %s', (_, address) => {
    expect(isOrchardUnifiedAddress(address)).toBe(false)
  })
})
