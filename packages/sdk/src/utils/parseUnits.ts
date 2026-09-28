/**
 * Multiplies a string representation of a number by a given exponent of base 10 (10exponent).
 * Copied from viem 2.56.9 (`Value.from` in `src/utils/unit/Value.ts`).
 */
export function parseUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(
      `\`decimals\` must be a non-negative integer. Got \`${decimals}\`.`
    )
  }

  // Unlike viem, which throws, an input with no digit is 0n, as it was before
  // the sync. The widget parses an empty amount field.
  if (/^-?\.?$/.test(value)) {
    return 0n
  }

  if (!/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value)) {
    throw new Error(`Number \`${value}\` is not a valid decimal number.`)
  }

  let [integer = '', fraction = '0'] = value.split('.')

  const negative = integer.startsWith('-')
  if (negative) {
    integer = integer.slice(1)
  }
  if (integer === '') {
    integer = '0'
  }

  // trim trailing zeros.
  fraction = fraction.replace(/(0+)$/, '')

  // round off if the fraction is larger than the number of decimals.
  if (decimals === 0) {
    // Round half away from zero by the first fractional digit.
    if (fraction.length > 0 && Number.parseInt(fraction[0], 10) >= 5) {
      integer = `${BigInt(integer) + 1n}`
    }
    fraction = ''
  } else if (fraction.length > decimals) {
    const left = fraction.slice(0, decimals)
    const roundDigit = Number.parseInt(
      fraction.slice(decimals, decimals + 1),
      10
    )

    if (roundDigit >= 5) {
      // Carry in decimal space, not through a JS number: a float loses
      // precision on long fractions and can round the wrong way.
      const carried = carry(left)
      if (carried.length > decimals) {
        // The carry overflowed into the integer part.
        fraction = carried.slice(1)
        integer = `${BigInt(integer) + 1n}`
      } else {
        fraction = carried
      }
    } else {
      fraction = left
    }
  } else {
    fraction = fraction.padEnd(decimals, '0')
  }

  return BigInt(`${negative ? '-' : ''}${integer}${fraction}`)
}

/**
 * Adds 1 to a digit string. The result has the same length, unless the carry
 * passes the most significant digit: then it is one digit longer.
 */
function carry(digits: string): string {
  const out = digits.split('')
  for (let i = out.length - 1; i >= 0; i--) {
    const digit = Number.parseInt(out[i], 10) + 1
    if (digit < 10) {
      out[i] = String(digit)
      return out.join('')
    }
    out[i] = '0'
  }
  return `1${out.join('')}`
}
