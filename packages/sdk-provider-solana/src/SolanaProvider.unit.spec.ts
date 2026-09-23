import { ChainType, ProviderError } from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { SolanaStepExecutor } from './core/SolanaStepExecutor.js'
import { SolanaProvider } from './SolanaProvider.js'

describe('SolanaProvider', () => {
  it('should create provider with default options', () => {
    const provider = SolanaProvider()

    expect(provider.type).toBe(ChainType.SVM)
    expect(provider.isAddress).toBeDefined()
    expect(provider.resolveAddress).toBeDefined()
    expect(provider.getBalance).toBeDefined()
    expect(provider.getStepExecutor).toBeDefined()
    expect(provider.setOptions).toBeDefined()
  })

  describe('isTokenAddress', () => {
    const provider = SolanaProvider()
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    it('accepts a mint, which uses the wallet format', () => {
      expect(provider.isTokenAddress?.(usdcMint)).toBe(true)
      expect(provider.isAddress(usdcMint)).toBe(true)
    })

    it('rejects other ecosystems and malformed values', () => {
      expect(
        provider.isTokenAddress?.('0xB095274743941e953c746F9C228DA9c18Bb6ec29')
      ).toBe(false)
      expect(provider.isTokenAddress?.('laptop')).toBe(false)
      expect(provider.isTokenAddress?.('')).toBe(false)
    })
  })

  it('should throw error when wallet adapter is not provided', async () => {
    const provider = SolanaProvider()
    const mockOptions = {
      routeId: 'test-route',
      executionOptions: {},
    } as any

    await expect(provider.getStepExecutor(mockOptions)).rejects.toThrowError(
      ProviderError
    )
  })

  it('should return step executor when wallet adapter is provided', async () => {
    const mockWalletAdapter = {
      publicKey: { toBase58: vi.fn() },
      signTransaction: vi.fn(),
    }

    const mockGetWalletAdapter = vi.fn().mockResolvedValue(mockWalletAdapter)

    const provider = SolanaProvider({
      getWallet: mockGetWalletAdapter,
    })

    const mockOptions = {
      routeId: 'test-route',
      executionOptions: {},
    } as any

    const executor = await provider.getStepExecutor(mockOptions)

    expect(executor).toBeDefined()
    expect(mockGetWalletAdapter).toHaveBeenCalledOnce()
  })

  describe('writeRpcUrls', () => {
    const FROM = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const wallet = { accounts: [{ address: FROM }] }
    const executorOptions = {
      routeId: 'test-route',
      executionOptions: {},
    } as any
    const baseContext = { step: { action: { fromAddress: FROM } } } as any

    it('hands the write RPCs to the step context', async () => {
      const provider = SolanaProvider({
        getWallet: async () => wallet as any,
        writeRpcUrls: ['https://write.example'],
      })

      const executor = (await provider.getStepExecutor(
        executorOptions
      )) as SolanaStepExecutor
      const context = await executor.createContext(baseContext)

      expect(context.writeRpcUrls).toEqual(['https://write.example'])
    })

    it('takes write RPCs set later through setOptions', async () => {
      const provider = SolanaProvider({ getWallet: async () => wallet as any })
      provider.setOptions({ writeRpcUrls: ['https://write.example'] })

      const executor = (await provider.getStepExecutor(
        executorOptions
      )) as SolanaStepExecutor
      const context = await executor.createContext(baseContext)

      expect(context.writeRpcUrls).toEqual(['https://write.example'])
    })
  })
})
