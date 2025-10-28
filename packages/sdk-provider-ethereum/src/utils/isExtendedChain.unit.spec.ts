import { describe, expect, it } from 'vitest'
import { isExtendedChain } from './isExtendedChain.js'

describe('isExtendedChain', () => {
  const validChain = {
    key: 'eth',
    chainType: 'EVM',
    coin: 'ETH',
    mainnet: true,
    logoURI: 'https://example.com/logo.png',
    metamask: {},
    nativeToken: {},
  }

  it('should return true for valid extended chain', () => {
    expect(isExtendedChain(validChain)).toBe(true)
  })

  it('should return false for null', () => {
    expect(isExtendedChain(null)).toBe(false)
  })

  it('should return false for missing metamask', () => {
    expect(isExtendedChain({ ...validChain, metamask: null })).toBe(false)
  })

  it('should return false for non-object', () => {
    expect(isExtendedChain('not-an-object')).toBe(false)
  })
})
