import { describe, expect, it } from 'vitest'
import { isZeroAddress } from './isZeroAddress.js'

describe('isZeroAddress', () => {
  it('should return true for EVM zero address', () => {
    expect(isZeroAddress('0x0000000000000000000000000000000000000000')).toBe(
      true
    )
  })

  it('should return true for Tron zero address', () => {
    expect(isZeroAddress('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')).toBe(true)
  })

  it('should return false for a valid address', () => {
    expect(isZeroAddress('TJRabPrwbZy45sbavfcjinPJC18kjpRTv8')).toBe(false)
  })
})
