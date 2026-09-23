import { ChainId, ChainType } from '@lifi/sdk'
import { Account, Keypair, MuxedAccount, StrKey } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { StellarProvider } from './StellarProvider.js'

describe('StellarProvider', () => {
  const provider = StellarProvider()

  it('has the Stellar chain type', () => {
    expect(provider.type).toBe(ChainType.STL)
  })

  describe('isAddress', () => {
    it('accepts a valid ed25519 G-address', () => {
      const g = Keypair.random().publicKey()
      expect(g.startsWith('G')).toBe(true)
      expect(provider.isAddress(g)).toBe(true)
    })

    it('rejects a muxed M-address (backend requires G-address senders)', () => {
      const g = Keypair.random().publicKey()
      const m = new MuxedAccount(new Account(g, '0'), '1').accountId()
      expect(m.startsWith('M')).toBe(true)
      expect(provider.isAddress(m)).toBe(false)
    })

    it('rejects a contract C-address', () => {
      const c = StrKey.encodeContract(Buffer.alloc(32, 1))
      expect(c.startsWith('C')).toBe(true)
      expect(provider.isAddress(c)).toBe(false)
    })

    it('rejects malformed and non-Stellar addresses', () => {
      expect(provider.isAddress('not-an-address')).toBe(false)
      expect(
        provider.isAddress('0x1234567890123456789012345678901234567890')
      ).toBe(false)
      expect(provider.isAddress('')).toBe(false)
    })
  })

  describe('isTokenAddress', () => {
    /** Keeps the length and the base32 charset, breaks only the CRC16. */
    const breakChecksum = (strKey: string): string =>
      `${strKey.slice(0, -1)}${strKey.endsWith('A') ? 'B' : 'A'}`

    it('accepts a contract C-address, which isAddress rejects', () => {
      const c = StrKey.encodeContract(Buffer.alloc(32, 1))
      expect(provider.isTokenAddress?.(c)).toBe(true)
      expect(provider.isAddress(c)).toBe(false)
    })

    it('accepts the live XLM and USDC contract ids', () => {
      expect(
        provider.isTokenAddress?.(
          'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA'
        )
      ).toBe(true)
      expect(
        provider.isTokenAddress?.(
          'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
        )
      ).toBe(true)
    })

    it('rejects an account G-address, because a token is not an account', () => {
      const g = Keypair.random().publicKey()
      expect(provider.isTokenAddress?.(g)).toBe(false)
    })

    it('rejects a C-address whose checksum is broken', () => {
      const c = breakChecksum(StrKey.encodeContract(Buffer.alloc(32, 1)))
      expect(c.startsWith('C')).toBe(true)
      expect(c).toHaveLength(56)
      expect(provider.isTokenAddress?.(c)).toBe(false)
    })

    it('rejects the right charset at the right length', () => {
      expect(provider.isTokenAddress?.(`C${'A'.repeat(55)}`)).toBe(false)
    })

    it('rejects malformed and non-Stellar values', () => {
      expect(provider.isTokenAddress?.('not-an-address')).toBe(false)
      expect(
        provider.isTokenAddress?.('0x1234567890123456789012345678901234567890')
      ).toBe(false)
      expect(provider.isTokenAddress?.('')).toBe(false)
    })
  })

  it('answers isAddress as without a chain ID', () => {
    const provider = StellarProvider()
    const g = Keypair.random().publicKey()
    expect(provider.isAddress(g, ChainId.XLM)).toBe(true)
    expect(provider.isAddress('laptop', ChainId.XLM)).toBe(false)
  })
})
