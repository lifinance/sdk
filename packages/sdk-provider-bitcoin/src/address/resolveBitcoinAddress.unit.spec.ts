import { describe, expect, it } from 'vitest'
import { resolveBitcoinAddress } from './resolveBitcoinAddress.js'

describe('resolveBitcoinAddress', () => {
  it('should return the input name without modification', async () => {
    const testAddress = 'bc1qtest123'
    const result = await resolveBitcoinAddress(testAddress)

    expect(result).toBe(testAddress)
  })
})
