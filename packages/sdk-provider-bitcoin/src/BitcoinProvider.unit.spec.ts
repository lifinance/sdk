import { ChainId, ChainType } from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
import { BitcoinProvider } from './BitcoinProvider.js'

describe('BitcoinProvider', () => {
  it('should create provider with default options', () => {
    const provider = BitcoinProvider()

    expect(provider.type).toBe(ChainType.UTXO)
    expect(provider.isAddress).toBeDefined()
    expect(provider.resolveAddress).toBeDefined()
    expect(provider.getBalance).toBeDefined()
    expect(provider.getStepExecutor).toBeDefined()
    expect(provider.setOptions).toBeDefined()
  })

  // The token list names the native coin `bitcoin`, so UTXO has no format.
  it('does not implement isTokenAddress', () => {
    expect(BitcoinProvider().isTokenAddress).toBeUndefined()
  })

  it('should throw error when client is not provided', async () => {
    const provider = BitcoinProvider()
    const mockOptions = {
      routeId: 'test-route',
      executionOptions: {},
    } as any

    await expect(provider.getStepExecutor(mockOptions)).rejects.toThrowError(
      'Client is not provided.'
    )
  })

  it('should return step executor when client is provided', async () => {
    const mockWalletClient = {
      account: { address: 'bc1qtest' },
    }

    const mockGetWalletClient = vi.fn().mockResolvedValue(mockWalletClient)

    const provider = BitcoinProvider({
      getWalletClient: mockGetWalletClient,
    })

    const mockOptions = {
      routeId: 'test-route',
      executionOptions: {},
    } as any

    const executor = await provider.getStepExecutor(mockOptions)

    expect(executor).toBeDefined()
    expect(mockGetWalletClient).toHaveBeenCalledOnce()
  })

  describe('isAddress', () => {
    const provider = BitcoinProvider()
    const bitcoinSegwit = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
    const bitcoinLegacy = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
    const zcashP2pkh = 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC'
    const zcashP2sh = 't3LmX1cxWPPPqL4TZHx42HU3U5ghbFjRiif'
    const zcashUnified =
      'u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf'

    it('keeps today’s answer without a chain ID and for Bitcoin', () => {
      for (const address of [
        bitcoinSegwit,
        bitcoinLegacy,
        zcashP2pkh,
        'not-an-address',
      ]) {
        expect(provider.isAddress(address, ChainId.BTC)).toBe(
          provider.isAddress(address)
        )
      }
      expect(provider.isAddress(bitcoinSegwit)).toBe(true)
      expect(provider.isAddress(zcashP2pkh)).toBe(false)
    })

    it('accepts only transparent Zcash addresses for ZEC', () => {
      expect(provider.isAddress(zcashP2pkh, ChainId.ZEC)).toBe(true)
      expect(provider.isAddress(zcashP2sh, ChainId.ZEC)).toBe(true)
      expect(provider.isAddress(zcashUnified, ChainId.ZEC)).toBe(false)
    })

    it('refuses a Bitcoin address for ZEC and a Zcash address for BTC', () => {
      expect(provider.isAddress(bitcoinSegwit, ChainId.ZEC)).toBe(false)
      expect(provider.isAddress(bitcoinLegacy, ChainId.ZEC)).toBe(false)
      expect(provider.isAddress(zcashP2pkh, ChainId.BTC)).toBe(false)
    })

    it('refuses every address for a UTXO chain it does not know', () => {
      for (const chainId of [ChainId.LTC, ChainId.BCH, ChainId.DGE]) {
        expect(provider.isAddress(bitcoinSegwit, chainId)).toBe(false)
        expect(provider.isAddress(zcashP2pkh, chainId)).toBe(false)
      }
    })
  })
})
