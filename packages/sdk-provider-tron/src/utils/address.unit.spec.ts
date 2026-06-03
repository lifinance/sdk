import { describe, expect, it } from 'vitest'
import { encodeAddressCalldata, toEvmHex } from './address.js'

// A real Tron base58 address — its hex form starts with '41'.
const TRON_ADDR = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'

describe('toEvmHex', () => {
  it('converts a 41-prefixed Tron hex address to an 0x-prefixed EVM hex address', () => {
    const result = toEvmHex(TRON_ADDR)
    expect(result.startsWith('0x')).toBe(true)
    // 0x + 40 hex chars = 42
    expect(result).toHaveLength(42)
  })

  it('throws on malformed input (TronWeb rejects invalid base58; our guard rejects non-41 hex)', () => {
    // Either TronWeb throws on invalid base58 OR our own prefix assertion fires
    // — both outcomes satisfy the "fail loudly on malformed input" contract.
    expect(() => toEvmHex('not-a-real-address')).toThrow()
  })
})

describe('encodeAddressCalldata', () => {
  it('pads a hex address to 32 bytes and concatenates the selector', () => {
    const result = encodeAddressCalldata(
      'deadbeef',
      '0x1111111111111111111111111111111111111111'
    )
    expect(result).toBe(
      '0xdeadbeef0000000000000000000000001111111111111111111111111111111111111111'
    )
  })

  it('handles lowercase addresses without a 0x prefix', () => {
    const result = encodeAddressCalldata(
      'cafebabe',
      '2222222222222222222222222222222222222222'
    )
    expect(result).toBe(
      '0xcafebabe0000000000000000000000002222222222222222222222222222222222222222'
    )
  })
})
