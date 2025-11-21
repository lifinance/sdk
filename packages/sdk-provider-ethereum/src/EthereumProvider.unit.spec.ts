import { ChainType } from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
import { EthereumProvider } from './EthereumProvider.js'

describe('EthereumProvider', () => {
  it('should create provider with default options', () => {
    const provider = EthereumProvider()

    expect(provider.type).toBe(ChainType.EVM)
    expect(provider.options).toBeDefined()
    expect(provider.isAddress).toBeDefined()
    expect(provider.resolveAddress).toBeDefined()
    expect(provider.getBalance).toBeDefined()
    expect(provider.getWalletClient).toBeUndefined()
    expect(provider.getStepExecutor).toBeDefined()
    expect(provider.setOptions).toBeDefined()
  })

  it('should throw error when client is not provided', async () => {
    const provider = EthereumProvider()
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
      chain: { id: 1 },
      account: { address: '0x1234567890123456789012345678901234567890' },
    }

    const mockGetWalletClient = vi.fn().mockResolvedValue(mockWalletClient)

    const provider = EthereumProvider({
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
})
