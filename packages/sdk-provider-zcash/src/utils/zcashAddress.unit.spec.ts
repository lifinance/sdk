import { describe, expect, it } from 'vitest'
import { isZcashAddress } from './zcashAddress.js'

// Sources: ZIP 320 (t1 and its TEX form), ZIP 214 (t3), zcash-test-vectors
// unified_address.json (u1, and the Sapling raw address of row 0 encoded as zs1).
const t1 = 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC'
const t3 = 't3LmX1cxWPPPqL4TZHx42HU3U5ghbFjRiif'
const tex = 'tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte'
const sapling =
  'zs1mrhc9y7jdh5r9ece8u5khgvj9kg0zgkxzdduyv0whkg7lkcrkx5xqem3e48avjq9wn2rukydkwn'
const unified =
  'u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf'
// The t1 above with its last character changed: the checksum no longer matches.
const t1WithBadChecksum = 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yD'
// Testnet forms of the same hash: version 0x1D25 and HRP `textest`.
const testnetTransparent = 'tmMcWbZU8t39htCR1fQRfRSHtkW4p3Ax5Se'
const testnetTex = 'textest1s2rt77ggv6q989lr49rkgzmh5slsksa90ej7wz'

describe('isZcashAddress', () => {
  it.each([
    ['p2pkh', t1],
    ['p2sh', t3],
  ])('accepts a %s address', (_, address) => {
    expect(isZcashAddress(address)).toBe(true)
  })

  it.each([
    ['a TEX address', tex],
    ['a Sapling address', sapling],
    ['a unified address', unified],
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
