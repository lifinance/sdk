import { ChainType } from '@lifi/sdk'
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
})
