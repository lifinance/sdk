import { describe, expect, it } from 'vitest'
import { formatUnits } from './formatUnits.js'

describe('formatUnits', () => {
  it('formats whole values', () => {
    expect(formatUnits(0n, 18)).toBe('0')
    expect(formatUnits(1000000000000000000n, 18)).toBe('1')
    expect(formatUnits(42n, 0)).toBe('42')
  })

  it('trims trailing zeros from the fraction', () => {
    expect(formatUnits(1500000000000000000n, 18)).toBe('1.5')
    expect(formatUnits(1000000n, 6)).toBe('1')
    expect(formatUnits(1234500n, 6)).toBe('1.2345')
  })

  it('left-pads values smaller than one unit', () => {
    expect(formatUnits(1n, 18)).toBe('0.000000000000000001')
    expect(formatUnits(500000n, 6)).toBe('0.5')
  })

  it('keeps the sign on negative values', () => {
    expect(formatUnits(-1500000000000000000n, 18)).toBe('-1.5')
    expect(formatUnits(-500000n, 6)).toBe('-0.5')
    expect(formatUnits(-1n, 18)).toBe('-0.000000000000000001')
  })

  it('holds precision above Number.MAX_SAFE_INTEGER', () => {
    expect(formatUnits(9007199254740993n, 0)).toBe('9007199254740993')
    expect(formatUnits(123456789012345678901234567890n, 18)).toBe(
      '123456789012.34567890123456789'
    )
  })
})
