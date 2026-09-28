import { describe, expect, it } from 'vitest'
import { formatUnits } from './formatUnits.js'

// Cases from viem 2.56.9 (`src/utils/unit/formatUnits.test.ts` and the
// `format` block of `src/utils/unit/Value.test.ts`).
describe('formatUnits', () => {
  it.each([
    [69n, 0, '69'],
    [69n, 5, '0.00069'],
    [690n, 1, '69'],
    [1300000n, 5, '13'],
    [40000000000000000000n, 18, '40'],
    [10000000000000n, 18, '0.00001'],
    [12345n, 4, '1.2345'],
    [6942069420123456789123450000n, 18, '6942069420.12345678912345'],
    [
      694212312312306942012345444446789123450000000000000000000000000000000n,
      50,
      '6942123123123069420.1234544444678912345',
    ],
    [-690n, 1, '-69'],
    [-12345n, 4, '-1.2345'],
    [-6942069420123456789123450000n, 18, '-6942069420.12345678912345'],
  ])('formats %s at %i decimals', (value, decimals, expected) => {
    expect(formatUnits(value, decimals)).toBe(expected)
  })

  it.each([-1, 1.5, Number.NaN])('rejects %d decimals', (decimals) => {
    expect(() => formatUnits(15n, decimals)).toThrow(
      `\`decimals\` must be a non-negative integer. Got \`${decimals}\`.`
    )
  })
})
