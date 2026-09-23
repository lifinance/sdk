import { ChainId, ChainType, ProviderError } from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
import { SuiProvider } from './SuiProvider.js'
import { SuiTokenLongAddress, SuiTokenShortAddress } from './types.js'

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

  describe('isTokenAddress', () => {
    const provider = SuiProvider()

    it('accepts both spellings of the native coin type, which isAddress rejects', () => {
      for (const coinType of [SuiTokenShortAddress, SuiTokenLongAddress]) {
        expect(provider.isTokenAddress?.(coinType)).toBe(true)
        expect(provider.isAddress(coinType)).toBe(false)
      }
    })

    it('accepts the live USDC coin type', () => {
      expect(
        provider.isTokenAddress?.(
          '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
        )
      ).toBe(true)
    })

    it('rejects a wallet address, because a token needs a module and a type', () => {
      const wallet = `0x${'ab'.repeat(32)}`
      expect(provider.isAddress(wallet)).toBe(true)
      expect(provider.isTokenAddress?.(wallet)).toBe(false)
    })

    it('rejects a coin type missing its type name', () => {
      expect(provider.isTokenAddress?.('0x2::sui')).toBe(false)
    })

    it('rejects addresses of other ecosystems and malformed values', () => {
      expect(
        provider.isTokenAddress?.('0xB095274743941e953c746F9C228DA9c18Bb6ec29')
      ).toBe(false)
      expect(
        provider.isTokenAddress?.(
          'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
        )
      ).toBe(false)
      expect(provider.isTokenAddress?.('laptop')).toBe(false)
      expect(provider.isTokenAddress?.('')).toBe(false)
    })
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

  it('answers isAddress as without a chain ID', () => {
    const provider = SuiProvider()
    const wallet = `0x${'ab'.repeat(32)}`
    expect(provider.isAddress(wallet, ChainId.SUI)).toBe(true)
    expect(provider.isAddress('laptop', ChainId.SUI)).toBe(false)
  })
})
