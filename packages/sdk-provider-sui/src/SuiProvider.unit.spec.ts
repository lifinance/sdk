import { ChainType, ProviderError } from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
import { SuiProvider } from './SuiProvider.js'

describe('SuiProvider', () => {
  const mockStepExecutorOptions = {
    routeId: 'test-route',
    executionOptions: {},
  } as any

  it('should create provider with default options', () => {
    const provider = SuiProvider()

    expect(provider.type).toBe(ChainType.MVM)
    expect(provider.isAddress).toBeDefined()
    expect(provider.resolveAddress).toBeDefined()
    expect(provider.getBalance).toBeDefined()
    expect(provider.getStepExecutor).toBeDefined()
    expect(provider.setOptions).toBeDefined()
  })

  it('should throw ProviderError when getClient is not provided', async () => {
    const provider = SuiProvider()

    await expect(
      provider.getStepExecutor(mockStepExecutorOptions)
    ).rejects.toThrowError(ProviderError)
  })

  it('should throw ProviderError when getSigner is not provided', async () => {
    const mockGetClient = vi.fn().mockResolvedValue({})
    const provider = SuiProvider({ getClient: mockGetClient })

    await expect(
      provider.getStepExecutor(mockStepExecutorOptions)
    ).rejects.toThrowError(ProviderError)
  })

  it('should return step executor when client and signer are provided', async () => {
    const mockClient = {
      getAccounts: vi.fn(),
      signAndExecuteTransaction: vi.fn(),
    }

    const mockGetClient = vi.fn().mockResolvedValue(mockClient)
    const mockGetSigner = vi.fn().mockResolvedValue({})

    const provider = SuiProvider({
      getClient: mockGetClient,
      getSigner: mockGetSigner,
    })

    const executor = await provider.getStepExecutor(mockStepExecutorOptions)

    expect(executor).toBeDefined()
    expect(mockGetClient).toHaveBeenCalledOnce()
    expect(mockGetSigner).toHaveBeenCalledOnce()
  })
})
