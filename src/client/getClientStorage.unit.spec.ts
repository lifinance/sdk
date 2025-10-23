import {
  ChainId,
  ChainKey,
  ChainType,
  CoinKey,
  type ExtendedChain,
} from '@lifi/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RPCUrls, SDKBaseConfig } from '../types/core.js'
import { getClientStorage } from './getClientStorage.js'

// Mock the dependencies
vi.mock('../actions/getChains.js', () => ({
  getChainsFromConfig: vi.fn(),
}))

vi.mock('../core/utils.js', () => ({
  getRpcUrlsFromChains: vi.fn(),
}))

describe('getClientStorage', () => {
  let mockConfig: SDKBaseConfig
  let mockChains: ExtendedChain[]
  let mockRpcUrls: RPCUrls

  beforeEach(() => {
    mockConfig = {
      integrator: 'test-app',
      apiUrl: 'https://li.quest/v1',
      debug: false,
      rpcUrls: {
        [ChainId.ETH]: ['https://eth-mainnet.alchemyapi.io/v2/test'],
      },
    }

    mockChains = [
      {
        id: ChainId.ETH,
        name: 'Ethereum',
        chainType: ChainType.EVM,
        key: ChainKey.ETH,
        coin: CoinKey.ETH,
        mainnet: true,
        nativeToken: {
          address: '0x0000000000000000000000000000000000000000',
          symbol: 'ETH',
          decimals: 18,
          name: 'Ethereum',
          chainId: ChainId.ETH,
          priceUSD: '0',
        },
        metamask: {
          chainId: '0x1',
          chainName: 'Ethereum',
          nativeCurrency: {
            name: 'Ethereum',
            symbol: 'ETH',
            decimals: 18,
          },
          rpcUrls: ['https://eth-mainnet.alchemyapi.io/v2/test'],
          blockExplorerUrls: ['https://etherscan.io'],
        },
      },
      {
        id: ChainId.POL,
        name: 'Polygon',
        chainType: ChainType.EVM,
        key: ChainKey.POL,
        coin: CoinKey.MATIC,
        mainnet: true,
        nativeToken: {
          address: '0x0000000000000000000000000000000000000000',
          symbol: 'MATIC',
          decimals: 18,
          name: 'Polygon',
          chainId: ChainId.POL,
          priceUSD: '0',
        },
        metamask: {
          chainId: '0x89',
          chainName: 'Polygon',
          nativeCurrency: {
            name: 'Polygon',
            symbol: 'MATIC',
            decimals: 18,
          },
          rpcUrls: ['https://polygon-rpc.com'],
          blockExplorerUrls: ['https://polygonscan.com'],
        },
      },
    ]

    mockRpcUrls = {
      [ChainId.ETH]: ['https://eth-mainnet.alchemyapi.io/v2/test'],
      [ChainId.POL]: ['https://polygon-rpc.com'],
    }

    // Reset mocks
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('needReset property', () => {
    it('should return true when chainsUpdatedAt is undefined', () => {
      const storage = getClientStorage(mockConfig)
      expect(storage.needReset).toBe(true) // Because _chainsUpdatedAt is undefined
    })

    it('should return true when chains are older than 24 hours', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      vi.mocked(getChainsFromConfig).mockResolvedValue(mockChains)
      vi.mocked(getRpcUrlsFromChains).mockReturnValue(mockRpcUrls)

      const storage = getClientStorage(mockConfig)

      // First call to getChains sets the timestamp
      await storage.getChains()

      // Mock Date.now to return a time 25 hours later
      const originalDateNow = Date.now
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000)

      expect(storage.needReset).toBe(true)

      // Restore Date.now
      Date.now = originalDateNow
    })

    it('should return false when chains are fresh', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      vi.mocked(getChainsFromConfig).mockResolvedValue(mockChains)
      vi.mocked(getRpcUrlsFromChains).mockReturnValue(mockRpcUrls)

      const storage = getClientStorage(mockConfig)

      // First call to getChains sets the timestamp
      await storage.getChains()

      // Should not need reset immediately after
      expect(storage.needReset).toBe(false)
    })
  })

  describe('getChains method', () => {
    it('should fetch chains when needReset is true', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      vi.mocked(getChainsFromConfig).mockResolvedValue(mockChains)
      vi.mocked(getRpcUrlsFromChains).mockReturnValue(mockRpcUrls)

      const storage = getClientStorage(mockConfig)
      const chains = await storage.getChains()

      expect(getChainsFromConfig).toHaveBeenCalledWith(mockConfig, {
        chainTypes: [
          ChainType.EVM,
          ChainType.SVM,
          ChainType.UTXO,
          ChainType.MVM,
        ],
      })
      expect(chains).toEqual(mockChains)
    })

    it('should return cached chains when not needReset and chains exist', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      vi.mocked(getChainsFromConfig).mockResolvedValue(mockChains)
      vi.mocked(getRpcUrlsFromChains).mockReturnValue(mockRpcUrls)

      const storage = getClientStorage(mockConfig)

      // First call fetches chains
      const chains1 = await storage.getChains()
      expect(getChainsFromConfig).toHaveBeenCalledTimes(1)

      // Second call should return cached chains
      const chains2 = await storage.getChains()
      expect(getChainsFromConfig).toHaveBeenCalledTimes(1)
      expect(chains1).toBe(chains2) // Same reference
    })

    it('should handle errors from getChainsFromConfig', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')

      const error = new Error('Failed to fetch chains')
      vi.mocked(getChainsFromConfig).mockRejectedValue(error)

      const configWithoutRpcUrls = {
        ...mockConfig,
        rpcUrls: {},
      }
      const storage = getClientStorage(configWithoutRpcUrls)

      await expect(storage.getChains()).rejects.toThrow(
        'Failed to fetch chains'
      )
    })
  })

  describe('getRpcUrls method', () => {
    it('should fetch RPC URLs when needReset is true', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      vi.mocked(getChainsFromConfig).mockResolvedValue(mockChains)
      vi.mocked(getRpcUrlsFromChains).mockReturnValue(mockRpcUrls)

      const configWithoutRpcUrls = {
        ...mockConfig,
        rpcUrls: {},
      }
      const storage = getClientStorage(configWithoutRpcUrls)
      const rpcUrls = await storage.getRpcUrls()

      expect(getRpcUrlsFromChains).toHaveBeenCalledWith({}, mockChains, [
        ChainId.SOL,
      ])
      expect(rpcUrls).toEqual(mockRpcUrls)
    })

    it('should return cached RPC URLs when not needReset and RPC URLs exist', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      vi.mocked(getChainsFromConfig).mockResolvedValue(mockChains)
      vi.mocked(getRpcUrlsFromChains).mockReturnValue(mockRpcUrls)

      const storage = getClientStorage(mockConfig)

      // First call getChains to set the timestamp and make needReset false
      await storage.getChains()

      // Now getRpcUrls should use existing RPC URLs without calling getRpcUrlsFromChains
      const rpcUrls1 = await storage.getRpcUrls()
      expect(getRpcUrlsFromChains).toHaveBeenCalledTimes(0) // Should use existing RPC URLs

      // Second call should return cached RPC URLs
      const rpcUrls2 = await storage.getRpcUrls()
      expect(getRpcUrlsFromChains).toHaveBeenCalledTimes(0)
      expect(rpcUrls1).toBe(rpcUrls2) // Same reference
    })

    it('should handle errors from getRpcUrlsFromChains', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      vi.mocked(getChainsFromConfig).mockResolvedValue(mockChains)
      const error = new Error('Failed to process RPC URLs')
      vi.mocked(getRpcUrlsFromChains).mockImplementation(() => {
        throw error
      })

      const configWithoutRpcUrls = {
        ...mockConfig,
        rpcUrls: {},
      }
      const storage = getClientStorage(configWithoutRpcUrls)

      await expect(storage.getRpcUrls()).rejects.toThrow(
        'Failed to process RPC URLs'
      )
    })
  })

  describe('caching behavior', () => {
    it('should reset cache when needReset becomes true', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      vi.mocked(getChainsFromConfig).mockResolvedValue(mockChains)
      vi.mocked(getRpcUrlsFromChains).mockReturnValue(mockRpcUrls)

      const configWithoutRpcUrls = {
        ...mockConfig,
        rpcUrls: {},
      }
      const storage = getClientStorage(configWithoutRpcUrls)

      // First call
      await storage.getChains()
      await storage.getRpcUrls()

      // Mock Date.now to return a time 25 hours later
      const originalDateNow = Date.now
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000)

      // Should refetch when needReset is true
      await storage.getChains()
      await storage.getRpcUrls()

      expect(getChainsFromConfig).toHaveBeenCalledTimes(2)
      expect(getRpcUrlsFromChains).toHaveBeenCalledTimes(1) // Only called once because we have existing RPC URLs

      // Restore Date.now
      Date.now = originalDateNow
    })
  })

  describe('edge cases', () => {
    it('should handle chains without metamask RPC URLs', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      const chainsWithoutRpcUrls = [
        {
          id: ChainId.ETH,
          name: 'Ethereum',
          key: ChainKey.ETH,
          chainType: ChainType.EVM,
          coin: CoinKey.ETH,
          mainnet: true,
          nativeToken: {
            address: '0x0000000000000000000000000000000000000000',
            symbol: 'ETH',
            decimals: 18,
            name: 'Ethereum',
            chainId: ChainId.ETH,
            priceUSD: '0',
          },
          metamask: {
            chainId: '0x1',
            chainName: 'Ethereum',
            nativeCurrency: {
              name: 'Ethereum',
              symbol: 'ETH',
              decimals: 18,
            },
            rpcUrls: [],
            blockExplorerUrls: ['https://etherscan.io'],
          },
        },
      ]

      vi.mocked(getChainsFromConfig).mockResolvedValue(chainsWithoutRpcUrls)
      vi.mocked(getRpcUrlsFromChains).mockReturnValue({})

      const configWithoutRpcUrls = {
        ...mockConfig,
        rpcUrls: {},
      }
      const storage = getClientStorage(configWithoutRpcUrls)

      const rpcUrls = await storage.getRpcUrls()

      expect(getRpcUrlsFromChains).toHaveBeenCalledWith(
        {},
        chainsWithoutRpcUrls,
        [ChainId.SOL]
      )
      expect(rpcUrls).toEqual({})
    })

    it('should preserve existing RPC URLs from config', async () => {
      const { getChainsFromConfig } = await import('../actions/getChains.js')
      const { getRpcUrlsFromChains } = await import('../core/utils.js')

      vi.mocked(getChainsFromConfig).mockResolvedValue(mockChains)
      vi.mocked(getRpcUrlsFromChains).mockReturnValue(mockRpcUrls)

      const storage = getClientStorage(mockConfig)

      // First call getChains to set the timestamp and make needReset false
      await storage.getChains()

      const rpcUrls = await storage.getRpcUrls()

      // Should not call getRpcUrlsFromChains because we already have RPC URLs
      expect(getRpcUrlsFromChains).not.toHaveBeenCalled()
      expect(rpcUrls).toEqual(mockConfig.rpcUrls)
    })
  })
})
