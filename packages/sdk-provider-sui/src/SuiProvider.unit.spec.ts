import { ChainType } from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
import { SuiProvider } from './SuiProvider.js'

describe('SuiProvider', () => {
  it('should create provider with default options', () => {
    const provider = SuiProvider()

    expect(provider.type).toBe(ChainType.MVM)
    expect(provider.isAddress).toBeDefined()
    expect(provider.resolveAddress).toBeDefined()
    expect(provider.getBalance).toBeDefined()
    expect(provider.getStepExecutor).toBeDefined()
    expect(provider.setOptions).toBeDefined()
  })

  it('should throw error when wallet is not provided', async () => {
    const provider = SuiProvider()
    const mockOptions = {
      routeId: 'test-route',
      executionOptions: {},
    } as any

    await expect(provider.getStepExecutor(mockOptions)).rejects.toThrowError(
      'getClient is not provided.'
    )
  })

  it('should return step executor when wallet is provided', async () => {
    const mockWallet = {
      getAccounts: vi.fn(),
      signAndExecuteTransaction: vi.fn(),
    }

    const mockGetWallet = vi.fn().mockResolvedValue(mockWallet)
    const mockSigner = vi.fn().mockResolvedValue({})

    const provider = SuiProvider({
      getClient: mockGetWallet,
      getSigner: mockSigner,
    })

    const mockOptions = {
      routeId: 'test-route',
      executionOptions: {},
    } as any

    const executor = await provider.getStepExecutor(mockOptions)

    expect(executor).toBeDefined()
    expect(mockGetWallet).toHaveBeenCalledOnce()
  })
})
