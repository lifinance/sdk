import { describe, expect, it } from 'vitest'
import { toXOnly } from './toXOnly.js'

describe('toXOnly', () => {
  it('should return 32-byte public key as-is', () => {
    const pubKey = new Uint8Array(32).fill(1)
    const result = toXOnly(pubKey)

    expect(result).toBe(pubKey)
    expect(result.length).toBe(32)
  })

  it('should extract last 32 bytes from 33-byte public key', () => {
    const pubKey = new Uint8Array(33)
    pubKey[0] = 2 // compressed prefix
    pubKey.fill(5, 1, 33) // rest of the key

    const result = toXOnly(pubKey)

    expect(result.length).toBe(32)
    expect(result[0]).toBe(5)
    expect(result[31]).toBe(5)
  })
})
