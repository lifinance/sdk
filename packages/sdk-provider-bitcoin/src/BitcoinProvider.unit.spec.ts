import { ChainType } from '@lifi/sdk'
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
})
