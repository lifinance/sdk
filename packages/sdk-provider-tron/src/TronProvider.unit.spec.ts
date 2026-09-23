import { ChainId } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { TronProvider } from './TronProvider.js'

describe('TronProvider', () => {
  describe('isTokenAddress', () => {
    const provider = TronProvider()
    const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

    it('accepts a token contract, which uses the wallet format', () => {
      expect(provider.isTokenAddress?.(usdtContract)).toBe(true)
      expect(provider.isAddress(usdtContract)).toBe(true)
    })

    it('rejects other ecosystems and malformed values', () => {
      expect(
        provider.isTokenAddress?.('0xB095274743941e953c746F9C228DA9c18Bb6ec29')
      ).toBe(false)
      expect(provider.isTokenAddress?.('laptop')).toBe(false)
      expect(provider.isTokenAddress?.('')).toBe(false)
    })
  })

  it('answers isAddress as without a chain ID', () => {
    const provider = TronProvider()
    const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    expect(provider.isAddress(usdtContract, ChainId.TRN)).toBe(true)
    for (const address of [usdtContract, 'laptop']) {
      expect(provider.isAddress(address, ChainId.TRN)).toBe(
        provider.isAddress(address)
      )
    }
    expect(provider.isAddress('laptop', ChainId.TRN)).toBe(false)
  })
})
