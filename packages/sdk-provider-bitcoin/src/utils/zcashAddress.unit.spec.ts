import { describe, expect, it } from 'vitest'
import {
  acceptedZcashAddressKinds,
  isZcashAddress,
  parseZcashAddress,
} from './zcashAddress.js'

// Sources: ZIP 320 (t1 and its TEX form), ZIP 214 (t3), zcash-test-vectors
// unified_address.json (u1, and the Sapling raw address of row 0 encoded as zs1).
const t1 = 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC'
const t3 = 't3LmX1cxWPPPqL4TZHx42HU3U5ghbFjRiif'
const tex = 'tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte'
const sapling =
  'zs1mrhc9y7jdh5r9ece8u5khgvj9kg0zgkxzdduyv0whkg7lkcrkx5xqem3e48avjq9wn2rukydkwn'
const unified =
  'u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf'
// The longest entry in unified_address.json: past Bech32's default 90-character limit.
const unifiedLongest =
  'u1tqx832p4wsfe9pd67ggm3qsmfuvdhqvw2259y7uwug7y0lpeu87fmgpqh3zmamex3fzs0d4ct4hhsg2csj5z0q5f3f7n656ap8e4nlng9c4440rz9s7ekxanfw6g84f7vu82fumtmlz3vstl2a9ufa0970k4knsz2wpsjt2xycqeay76pt4fx3ak9y7mps2q6qe2n2h7wkakxr7xu6vd36zhhzgln7ttmrzc0f9ye3jmyu2pp8l8rect87lfxj2fgckcwz3svdx70a947fz04kgu7e907enzrk676zdkdmuyw2kyrclkmj62kmyy2rjetpus7knmxfuu7z0m63uwfhdynhuu3yrjqu5y089v8zwnh60mw5ngc0kszdjmc339fk9mjn396m5ekv7h7td7fa0u9097xph3y5vth9af4sw6ykxdms84wr544mxxqtmgj027d9e8rnlrazge0kwyydyhder3chwhmaqjk9skuxgxzternw4xx962qed'
// The t1 above with its last character changed: the checksum no longer matches.
const t1WithBadChecksum = 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yD'
// Testnet forms of the same hash: version 0x1D25 and HRP `textest`.
const testnetTransparent = 'tmMcWbZU8t39htCR1fQRfRSHtkW4p3Ax5Se'
const testnetTex = 'textest1s2rt77ggv6q989lr49rkgzmh5slsksa90ej7wz'
const bitcoinSegwit = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
const bitcoinLegacy = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'

describe('parseZcashAddress', () => {
  it.each([
    ['p2pkh', t1],
    ['p2sh', t3],
    ['tex', tex],
    ['sapling', sapling],
    ['unified', unified],
    ['unified', unifiedLongest],
  ])('decodes a %s address', (kind, address) => {
    expect(parseZcashAddress(address)).toBe(kind)
  })

  it.each([
    ['a corrupted checksum', t1WithBadChecksum],
    ['a testnet transparent address', testnetTransparent],
    ['a testnet TEX address', testnetTex],
    ['a Bitcoin segwit address', bitcoinSegwit],
    ['a Bitcoin legacy address', bitcoinLegacy],
    ['an EVM address', '0xB095274743941e953c746F9C228DA9c18Bb6ec29'],
    ['an empty string', ''],
    ['free text', 'not-an-address'],
  ])('rejects %s', (_, address) => {
    expect(parseZcashAddress(address)).toBeUndefined()
  })
})

describe('isZcashAddress', () => {
  it('accepts only the transparent kinds a route may send to', () => {
    expect([...acceptedZcashAddressKinds].sort()).toEqual(['p2pkh', 'p2sh'])
    expect(isZcashAddress(t1)).toBe(true)
    expect(isZcashAddress(t3)).toBe(true)
  })

  it('refuses kinds the backend does not handle yet', () => {
    expect(isZcashAddress(tex)).toBe(false)
    expect(isZcashAddress(sapling)).toBe(false)
    expect(isZcashAddress(unified)).toBe(false)
  })

  it('refuses a corrupted checksum and addresses of other chains', () => {
    expect(isZcashAddress(t1WithBadChecksum)).toBe(false)
    expect(isZcashAddress(bitcoinSegwit)).toBe(false)
    expect(isZcashAddress(bitcoinLegacy)).toBe(false)
  })
})
