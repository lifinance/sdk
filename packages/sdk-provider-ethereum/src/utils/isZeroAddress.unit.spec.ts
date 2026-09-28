import { describe, expect, it } from 'vitest'
import { isZeroAddress } from './isZeroAddress.js'

describe('isZeroAddress', () => {
  it('should return true for zero address', () => {
    expect(isZeroAddress('0x0000000000000000000000000000000000000000')).toBe(
      true
    )
  })

  it('should return true for alternative zero address', () => {
    expect(isZeroAddress('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')).toBe(
      true
    )
  })

  it('should return true for the checksummed alternative zero address', () => {
    expect(isZeroAddress('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')).toBe(
      true
    )
  })

  it('should return false for a missing address', () => {
    // JavaScript callers can pass a token without an address.
    expect(isZeroAddress(undefined as unknown as string)).toBe(false)
  })

  it('should return false for valid address', () => {
    expect(isZeroAddress('0x1234567890123456789012345678901234567890')).toBe(
      false
    )
  })
})
