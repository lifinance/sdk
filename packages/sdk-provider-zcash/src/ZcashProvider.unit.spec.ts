import { ChainId, ChainType, type SDKClient, type Token } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { ZcashProvider } from './ZcashProvider.js'

const t1 = 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC'
const t3 = 't3LmX1cxWPPPqL4TZHx42HU3U5ghbFjRiif'
const unified =
  'u1k9eh52jx5q4y8lw6x208lsep4t6yzwk7mdwz9e6239qywjkqzdcd3al3d64zwnqx296p3klxnash5w2e0elg39qrydxx0s0qz5m2gnt0'
const bitcoin = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
const client = {} as SDKClient

describe('ZcashProvider', () => {
  const provider = ZcashProvider()

  it('serves ZEC as a UTXO chain', () => {
    expect(provider.type).toBe(ChainType.UTXO)
    expect(provider.chainIds).toEqual([ChainId.ZEC])
  })

  it('accepts a transparent or Orchard unified address without a chain and for ZEC', () => {
    for (const address of [t1, t3, unified]) {
      expect(provider.isAddress(address)).toBe(true)
      expect(provider.isAddress(address, ChainId.ZEC)).toBe(true)
    }
  })

  it('refuses a Zcash address for any other chain', () => {
    expect(provider.isAddress(t1, ChainId.BTC)).toBe(false)
    expect(provider.isAddress(t1, ChainId.ETH)).toBe(false)
    expect(provider.isAddress(unified, ChainId.BTC)).toBe(false)
  })

  it('refuses a Bitcoin address', () => {
    expect(provider.isAddress(bitcoin)).toBe(false)
    expect(provider.isAddress(bitcoin, ChainId.ZEC)).toBe(false)
  })

  it('resolves no names', async () => {
    await expect(
      provider.resolveAddress('alice.zec', client)
    ).resolves.toBeUndefined()
  })

  it('leaves every balance unknown', async () => {
    const token: Token = {
      chainId: ChainId.ZEC,
      address: 'zcash',
      symbol: 'ZEC',
      decimals: 8,
      name: 'Zcash',
      priceUSD: '0',
    }

    const [balance] = await provider.getBalance(client, t1, [token])

    expect(balance).toEqual(token)
    expect(balance).not.toBe(token)
    expect(balance).not.toHaveProperty('amount')
  })

  it('cannot execute a step', async () => {
    await expect(
      provider.getStepExecutor({ routeId: 'route' })
    ).rejects.toThrow('ZEC is a destination-only chain.')
  })
})
