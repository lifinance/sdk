import { describe, expect, it } from 'vitest'
import { isZcashAddress } from './zcashAddress.js'

// Sources: ZIP 320 (t1 and its TEX form), ZIP 214 (t3), zcash-test-vectors
// unified_address.json (row 0: transparent and Sapling receivers, and that
// Sapling raw address encoded as zs1), and a Zashi address with an Orchard receiver.
const t1 = 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC'
const t3 = 't3LmX1cxWPPPqL4TZHx42HU3U5ghbFjRiif'
const tex = 'tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte'
const sapling =
  'zs1mrhc9y7jdh5r9ece8u5khgvj9kg0zgkxzdduyv0whkg7lkcrkx5xqem3e48avjq9wn2rukydkwn'
const unifiedWithoutOrchard =
  'u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf'
const unifiedWithOrchard =
  'u1k9eh52jx5q4y8lw6x208lsep4t6yzwk7mdwz9e6239qywjkqzdcd3al3d64zwnqx296p3klxnash5w2e0elg39qrydxx0s0qz5m2gnt0'
// The t1 above with its last character changed: the checksum no longer matches.
const t1WithBadChecksum = 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yD'
// Testnet forms of the same hash: version 0x1D25 and HRP `textest`.
const testnetTransparent = 'tmMcWbZU8t39htCR1fQRfRSHtkW4p3Ax5Se'
const testnetTex = 'textest1s2rt77ggv6q989lr49rkgzmh5slsksa90ej7wz'

describe('isZcashAddress', () => {
  it.each([
    ['a p2pkh', t1],
    ['a p2sh', t3],
    ['an Orchard unified', unifiedWithOrchard],
  ])('accepts %s address', (_, address) => {
    expect(isZcashAddress(address)).toBe(true)
  })

  it.each([
    ['a TEX address', tex],
    ['a Sapling address', sapling],
    ['a unified address without an Orchard receiver', unifiedWithoutOrchard],
    ['a corrupted checksum', t1WithBadChecksum],
    ['a testnet transparent address', testnetTransparent],
    ['a testnet TEX address', testnetTex],
    ['a Bitcoin segwit address', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ['a Bitcoin legacy address', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
    ['an EVM address', '0xB095274743941e953c746F9C228DA9c18Bb6ec29'],
    ['an empty string', ''],
    ['free text', 'not-an-address'],
  ])('refuses %s', (_, address) => {
    expect(isZcashAddress(address)).toBe(false)
  })
})
