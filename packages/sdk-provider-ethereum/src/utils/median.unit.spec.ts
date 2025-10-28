import { describe, expect, it } from 'vitest'
import { median } from './median.js'

describe('median', () => {
  it('should return undefined for empty array', () => {
    expect(median([])).toBeUndefined()
  })

  it('should return middle value for odd length array', () => {
    expect(median([1n, 2n, 3n, 4n, 5n])).toBe(3n)
  })

  it('should return average of middle values for even length', () => {
    expect(median([1n, 2n, 3n, 4n])).toBe(2n)
  })

  it('should handle single element', () => {
    expect(median([5n])).toBe(5n)
  })

  it('should sort values before calculating', () => {
    expect(median([5n, 1n, 3n])).toBe(3n)
  })
})
