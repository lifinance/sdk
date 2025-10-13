import type { StaticToken } from '@lifi/types'
import { describe, expect, it } from 'vitest'
import { isToken } from './isToken.js'

describe('isToken', () => {
  it('should return true for valid token', () => {
    const token = {
      address: '0x1234567890123456789012345678901234567890',
      decimals: 18,
      chainId: 1,
      symbol: 'ETH',
    } as StaticToken

    expect(isToken(token)).toBe(true)
  })

  it('should return false for invalid address', () => {
    const token = {
      address: 123,
      decimals: 18,
      chainId: 1,
      symbol: 'ETH',
    }

    expect(isToken(token as any)).toBe(false)
  })

  it('should return false for invalid decimals', () => {
    const token = {
      address: '0x123',
      decimals: '18',
      chainId: 1,
      symbol: 'ETH',
    }

    expect(isToken(token as any)).toBe(false)
  })

  it('should return false for invalid chainId', () => {
    const token = {
      address: '0x123',
      decimals: 18,
      chainId: '1',
      symbol: 'ETH',
    }

    expect(isToken(token as any)).toBe(false)
  })
})
