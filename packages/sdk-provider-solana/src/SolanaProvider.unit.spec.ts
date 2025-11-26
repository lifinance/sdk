import { ChainType } from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
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

  it('should throw error when wallet adapter is not provided', async () => {
    const provider = SolanaProvider()
    const mockOptions = {
      routeId: 'test-route',
      executionOptions: {},
    } as any

    await expect(provider.getStepExecutor(mockOptions)).rejects.toThrowError(
      'getWalletAdapter is not provided.'
    )
  })

  it('should return step executor when wallet adapter is provided', async () => {
    const mockWalletAdapter = {
      publicKey: { toBase58: vi.fn() },
      signTransaction: vi.fn(),
    }

    const mockGetWalletAdapter = vi.fn().mockResolvedValue(mockWalletAdapter)

    const provider = SolanaProvider({
      getWalletAdapter: mockGetWalletAdapter,
    })

    const mockOptions = {
      routeId: 'test-route',
      executionOptions: {},
    } as any

    const executor = await provider.getStepExecutor(mockOptions)

    expect(executor).toBeDefined()
    expect(mockGetWalletAdapter).toHaveBeenCalledOnce()
  })
})
