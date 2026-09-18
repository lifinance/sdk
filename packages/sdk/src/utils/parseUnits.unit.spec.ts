import { describe, expect, it } from 'vitest'
import { formatUnits } from './formatUnits.js'
import { parseUnits } from './parseUnits.js'

describe('parseUnits', () => {
  it('scales integers and fractions', () => {
    expect(parseUnits('1', 18)).toBe(1000000000000000000n)
    expect(parseUnits('1.5', 18)).toBe(1500000000000000000n)
    expect(parseUnits('0', 18)).toBe(0n)
    expect(parseUnits('1.2345', 6)).toBe(1234500n)
  })

  it('accepts values written without an integer or fraction part', () => {
    expect(parseUnits('.5', 2)).toBe(50n)
    expect(parseUnits('1.', 2)).toBe(100n)
    expect(parseUnits('-.5', 2)).toBe(-50n)
  })

  it('rounds a fraction longer than decimals, half away from zero', () => {
    expect(parseUnits('1.004', 2)).toBe(100n)
    expect(parseUnits('1.005', 2)).toBe(101n)
    expect(parseUnits('1.006', 2)).toBe(101n)
    expect(parseUnits('-1.005', 2)).toBe(-101n)
  })

  it('carries the rounding into the integer part', () => {
    expect(parseUnits('1.96', 1)).toBe(20n)
    expect(parseUnits('0.999', 2)).toBe(100n)
    expect(parseUnits('9.99', 1)).toBe(100n)
    expect(parseUnits('-0.999', 2)).toBe(-100n)
  })

  it('rounds to a whole number when decimals is 0', () => {
    expect(parseUnits('1.4', 0)).toBe(1n)
    expect(parseUnits('1.5', 0)).toBe(2n)
    expect(parseUnits('-1.5', 0)).toBe(-2n)
  })

  it('holds precision above Number.MAX_SAFE_INTEGER', () => {
    expect(parseUnits('9007199254740993', 0)).toBe(9007199254740993n)
    expect(parseUnits('123456789012.34567890123456789', 18)).toBe(
      123456789012345678901234567890n
    )
  })

  it('rejects values that are not decimal numbers', () => {
    expect(() => parseUnits('1e18', 18)).toThrow(
      'Number `1e18` is not a valid decimal number.'
    )
    expect(() => parseUnits('0x1', 18)).toThrow()
    expect(() => parseUnits('1.2.3', 18)).toThrow()
  })

  it('round-trips through formatUnits', () => {
    for (const [value, decimals] of [
      ['1.5', 18],
      ['0.000000000000000001', 18],
      ['-0.5', 6],
      ['123456789012.34567890123456789', 18],
    ] as const) {
      expect(formatUnits(parseUnits(value, decimals), decimals)).toBe(value)
    }
  })
})
