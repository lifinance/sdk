import { describe, expect, it } from 'vitest'
import { parseUnits } from './parseUnits.js'

describe('parseUnits', () => {
  it.each([
    ['69', 1, 690n],
    ['13', 5, 1300000n],
    ['420', 10, 4200000000000n],
    ['40', 18, 40000000000000000000n],
    ['1.2345', 4, 12345n],
    ['1.0045', 4, 10045n],
    ['1.2345000', 4, 12345n],
    ['6942069420.12345678912345', 18, 6942069420123456789123450000n],
    ['6942069420.00045678912345', 18, 6942069420000456789123450000n],
    [
      '6942123123123069420.1234544444678912345',
      50,
      694212312312306942012345444446789123450000000000000000000000000000000n,
    ],
    ['-69', 1, -690n],
    ['-1.2345', 4, -12345n],
    ['-6942069420.12345678912345', 18, -6942069420123456789123450000n],
    ['.5', 1, 5n],
    ['-.5', 1, -5n],
    ['5.', 2, 500n],
  ])('parses %s at %i decimals', (value, decimals, expected) => {
    expect(parseUnits(value, decimals)).toBe(expected)
  })

  it.each([
    ['69.2352112312312451512412341231', 69n],
    ['69.5952141234124125231523412312', 70n],
    ['12301000000000000020000', 12301000000000000020000n],
    ['12301000000000000020000.123', 12301000000000000020000n],
    ['12301000000000000020000.5', 12301000000000000020001n],
    ['99999999999999999999999.5', 100000000000000000000000n],
    ['.5', 1n],
    ['-1.5', -2n],
  ])('rounds %s at 0 decimals', (value, expected) => {
    expect(parseUnits(value, 0)).toBe(expected)
  })

  it.each([
    ['69.23521', 1, 692n],
    ['69.23521', 2, 6924n],
    ['69.23221', 2, 6923n],
    ['69.23261', 3, 69233n],
    ['999999.99999', 3, 1000000000n],
    ['699999.98999', 3, 699999990n],
    ['100000.000999', 3, 100000001n],
    ['1.0536059576998882', 7, 10536060n],
    ['1.0000009900000000', 7, 10000010n],
    ['1.4545454545454545', 7, 14545455n],
    ['9.9999999999999999', 7, 100000000n],
    ['0.0000000900000000', 7, 1n],
    ['0.0999999999999999', 7, 1000000n],
    ['0.00000000059', 9, 1n],
    ['0.0000000003', 9, 0n],
    ['69.59000002359', 9, 69590000024n],
    ['-0.05', 1, -1n],
  ])('rounds %s at %i decimals', (value, decimals, expected) => {
    expect(parseUnits(value, decimals)).toBe(expected)
  })

  // `Math.round(Number(...))` is not exact for long fractions.
  it.each([
    ['1.4499999999999999999', 1, 14n],
    ['1.14999999999999999', 1, 11n],
    ['0.49999999999999999', 0, 0n],
    [
      '1.000000000000000004999999999999999999999999999999999999999999999999999999',
      18,
      1000000000000000005n,
    ],
    [
      '1.000000000000000004499999999999999999999999999999999999999999999999999999',
      18,
      1000000000000000004n,
    ],
  ])(
    'rounds the long fraction %s at %i decimals exactly',
    (value, decimals, expected) => {
      expect(parseUnits(value, decimals)).toBe(expected)
    }
  )

  // The widget parses an empty amount field.
  it.each(['', '.', '-', '-.'])(
    'parses %j, which has no digit, as 0n',
    (value) => {
      expect(parseUnits(value, 18)).toBe(0n)
      expect(parseUnits(value, 0)).toBe(0n)
    }
  )

  it.each(['123.456.789', '100e2', '0x50', '1-', '--1', ' 1'])(
    'rejects %j',
    (value) => {
      expect(() => parseUnits(value, 18)).toThrow(
        `Number \`${value}\` is not a valid decimal number.`
      )
    }
  )

  it.each([-1, 1.5, Number.NaN])('rejects %d decimals', (decimals) => {
    expect(() => parseUnits('1.5', decimals)).toThrow(
      `\`decimals\` must be a non-negative integer. Got \`${decimals}\`.`
    )
  })
})
