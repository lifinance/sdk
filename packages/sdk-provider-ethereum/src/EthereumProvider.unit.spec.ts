import { ChainId, ChainType } from '@lifi/sdk'
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

  describe('isTokenAddress', () => {
    const provider = EthereumProvider()
    const usdt = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

    it('accepts a checksummed address, as isAddress does', () => {
      expect(provider.isTokenAddress?.(usdt)).toBe(true)
      expect(provider.isAddress(usdt)).toBe(true)
    })

    it('accepts a pasted address whose letter case fails the checksum', () => {
      const upperCased = `0x${usdt.slice(2).toUpperCase()}`
      expect(provider.isAddress(upperCased)).toBe(false)
      expect(provider.isTokenAddress?.(upperCased)).toBe(true)
      expect(provider.isTokenAddress?.(usdt.toLowerCase())).toBe(true)
    })

    it('rejects an uppercase 0X prefix', () => {
      expect(provider.isTokenAddress?.(`0X${usdt.slice(2)}`)).toBe(false)
    })

    it('rejects a truncated address', () => {
      expect(provider.isTokenAddress?.(usdt.slice(0, -1))).toBe(false)
    })

    it('rejects addresses of other ecosystems and malformed values', () => {
      expect(provider.isTokenAddress?.('0x2::coin::COIN')).toBe(false)
      expect(
        provider.isTokenAddress?.(
          'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
        )
      ).toBe(false)
      expect(provider.isTokenAddress?.('laptop')).toBe(false)
      expect(provider.isTokenAddress?.('')).toBe(false)
    })
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

  describe('isAddress with a chain ID', () => {
    const provider = EthereumProvider()
    const usdt = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

    it('answers as without one, for every EVM chain', () => {
      for (const address of [
        usdt,
        usdt.toLowerCase(),
        `0x${usdt.slice(2).toUpperCase()}`,
        'laptop',
      ]) {
        for (const chainId of [ChainId.ETH, ChainId.ARB]) {
          expect(provider.isAddress(address, chainId)).toBe(
            provider.isAddress(address)
          )
        }
      }
    })
  })
})
