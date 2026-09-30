import { ChainId, ChainType, type SDKProvider } from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
import { BitcoinProvider } from './BitcoinProvider.js'
import { isBitcoinProvider } from './types.js'

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

    it('refuses every address for a UTXO chain other than BTC', () => {
      for (const chainId of [
        ChainId.ZEC,
        ChainId.LTC,
        ChainId.BCH,
        ChainId.DGE,
      ]) {
        expect(provider.isAddress(bitcoinSegwit, chainId)).toBe(false)
        expect(provider.isAddress(zcashP2pkh, chainId)).toBe(false)
      }
    })
  })

  describe('isBitcoinProvider', () => {
    it('matches the Bitcoin provider only', () => {
      const otherUtxoProvider: SDKProvider = {
        type: ChainType.UTXO,
        chainIds: [ChainId.ZEC],
        isAddress: () => false,
        resolveAddress: async () => undefined,
        getBalance: async () => [],
        getStepExecutor: async () => {
          throw new Error('Not used.')
        },
      }

      expect(isBitcoinProvider(BitcoinProvider())).toBe(true)
      expect(isBitcoinProvider(otherUtxoProvider)).toBe(false)
    })
  })
})
