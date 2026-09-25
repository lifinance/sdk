import { describe, expect, it } from 'vitest'
import { parseUnits } from './parseUnits.js'

describe('parseUnits', () => {
  it('encodes a decimal amount at the given scale', () => {
    expect(parseUnits('1.5', 18)).toBe(1500000000000000000n)
  })

  it('rejects a negative decimal count', () => {
    // 1.5 at -1 decimals currently returns 2n instead of throwing.
    expect(() => parseUnits('1.5', -1)).toThrow(
      'Decimals `-1` is not a non-negative integer.'
    )
  })
})
