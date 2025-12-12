import { ChainId, ChainType } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SDKConfig } from '../types/core.js'
import { createClient } from './createClient.js'

// Mock providers locally
const createMockProvider = (type: ChainType) => ({
  type,
  resolveAddress: vi.fn(),
  isAddress: vi.fn(),
  getBalance: vi.fn(),
  getStepExecutor: vi.fn(),
  setOptions: vi.fn(),
})

const EVM = (_options?: any) => createMockProvider('EVM' as ChainType)
const Solana = (_options?: any) => createMockProvider('SVM' as ChainType)
const UTXO = (_options?: any) => createMockProvider('UTXO' as ChainType)

// Mock the version check
vi.mock('../utils/checkPackageUpdates.js', () => ({
  checkPackageUpdates: vi.fn(),
}))

// Mock the client storage
const mockSetChains = vi.fn()
vi.mock('./getClientStorage.js', () => ({
  getClientStorage: vi.fn(() => ({
    getChains: vi.fn().mockResolvedValue([
      { id: 1, name: 'Ethereum', type: ChainType.EVM },
      { id: 137, name: 'Polygon', type: ChainType.EVM },
    ]),
    getRpcUrls: vi.fn().mockResolvedValue({
      [ChainId.ETH]: ['https://eth-mainnet.alchemyapi.io/v2/test'],
      [ChainId.POL]: ['https://polygon-rpc.com'],
    }),
    setChains: mockSetChains,
  })),
}))

describe('createClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic functionality', () => {
    it('should create a client with minimal config', () => {
      const client = createClient({
        integrator: 'test-app',
      })

      expect(client).toBeDefined()
      expect(client.config.integrator).toBe('test-app')
      expect(client.config.apiUrl).toBe('https://li.quest/v1')
      expect(client.config.debug).toBe(false)
      expect(client.providers).toEqual([])
    })

    it('should create a client with full config', () => {
      const config: SDKConfig = {
        integrator: 'test-app',
        apiKey: 'test-api-key',
        apiUrl: 'https://custom-api.com',
        userId: 'user-123',
        debug: true,
        disableVersionCheck: true,
        widgetVersion: '1.0.0',
        rpcUrls: {
          [ChainId.ETH]: ['https://eth-mainnet.alchemyapi.io/v2/test'],
        },
      }

      const client = createClient(config)

      expect(client.config).toEqual({
        integrator: 'test-app',
        apiKey: 'test-api-key',
        apiUrl: 'https://custom-api.com',
        userId: 'user-123',
        debug: true,
        disableVersionCheck: true,
        widgetVersion: '1.0.0',
        rpcUrls: {
          [ChainId.ETH]: ['https://eth-mainnet.alchemyapi.io/v2/test'],
        },
      })
    })

    it('should throw error when integrator is missing', () => {
      expect(() => {
        createClient({} as SDKConfig)
      }).toThrow(
        'Integrator not found. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
      )
    })

    it('should throw error when integrator is empty string', () => {
      expect(() => {
        createClient({ integrator: '' })
      }).toThrow(
        'Integrator not found. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
      )
    })
  })

  describe('provider management', () => {
    it('should handle empty providers list', () => {
      const client = createClient({ integrator: 'test-app' })
      expect(client.providers).toEqual([])
      expect(client.getProvider(ChainType.EVM)).toBeUndefined()
    })

    it('should set and get providers', () => {
      const client = createClient({ integrator: 'test-app' })
      const evmProvider = EVM()
      const solanaProvider = Solana()

      client.setProviders([evmProvider, solanaProvider])

      expect(client.providers).toHaveLength(2)
      expect(client.getProvider(ChainType.EVM)).toBe(evmProvider)
      expect(client.getProvider(ChainType.SVM)).toBe(solanaProvider)
      expect(client.getProvider(ChainType.UTXO)).toBeUndefined()
    })

    it('should merge providers when setting new ones', () => {
      const client = createClient({ integrator: 'test-app' })
      const evmProvider = EVM()
      const utxoProvider = UTXO()

      client.setProviders([evmProvider])
      expect(client.providers).toHaveLength(1)

      client.setProviders([utxoProvider])
      expect(client.providers).toHaveLength(2)
      expect(client.getProvider(ChainType.EVM)).toBe(evmProvider)
      expect(client.getProvider(ChainType.UTXO)).toBe(utxoProvider)
    })

    it('should merge providers when setting overlapping types', () => {
      const client = createClient({ integrator: 'test-app' })
      const evmProvider1 = EVM()
      const evmProvider2 = EVM()
      const solanaProvider = Solana()

      client.setProviders([evmProvider1])
      client.setProviders([evmProvider2, solanaProvider])

      expect(client.providers).toHaveLength(2)
      expect(client.getProvider(ChainType.EVM)).toBe(evmProvider2)
      expect(client.getProvider(ChainType.SVM)).toBe(solanaProvider)
    })
  })

  describe('chain management', () => {
    it('should get chains from storage', async () => {
      const client = createClient({ integrator: 'test-app' })
      const chains = await client.getChains()

      expect(chains).toEqual([
        { id: 1, name: 'Ethereum', type: ChainType.EVM },
        { id: 137, name: 'Polygon', type: ChainType.EVM },
      ])
    })

    it('should get chain by id', async () => {
      const client = createClient({ integrator: 'test-app' })
      const chain = await client.getChainById(1)

      expect(chain).toEqual({ id: 1, name: 'Ethereum', type: ChainType.EVM })
    })

    it('should throw error when chain not found', async () => {
      const client = createClient({ integrator: 'test-app' })

      await expect(client.getChainById(999)).rejects.toThrow(
        'ChainId 999 not found'
      )
    })

    it('should set chains via storage', () => {
      const client = createClient({ integrator: 'test-app' })
      const chains = [{ id: 1, name: 'Ethereum', type: ChainType.EVM }] as any

      client.setChains(chains)

      expect(mockSetChains).toHaveBeenCalledWith(chains)
    })
  })

  describe('RPC URL management', () => {
    it('should get RPC URLs from storage', async () => {
      const client = createClient({ integrator: 'test-app' })
      const rpcUrls = await client.getRpcUrls()

      expect(rpcUrls).toEqual({
        [ChainId.ETH]: ['https://eth-mainnet.alchemyapi.io/v2/test'],
        [ChainId.POL]: ['https://polygon-rpc.com'],
      })
    })

    it('should get RPC URLs by chain id', async () => {
      const client = createClient({ integrator: 'test-app' })
      const ethUrls = await client.getRpcUrlsByChainId(ChainId.ETH)
      const polUrls = await client.getRpcUrlsByChainId(ChainId.POL)

      expect(ethUrls).toEqual(['https://eth-mainnet.alchemyapi.io/v2/test'])
      expect(polUrls).toEqual(['https://polygon-rpc.com'])
    })

    it('should throw error when RPC URLs not found for chain', async () => {
      const client = createClient({ integrator: 'test-app' })

      await expect(client.getRpcUrlsByChainId(999)).rejects.toThrow(
        'RPC URL not found for chainId: 999'
      )
    })
  })

  describe('extend functionality', () => {
    it('should extend client with additional functionality', () => {
      const client = createClient({ integrator: 'test-app' })

      const extendedClient = (client as any).extend((_baseClient: any) => ({
        customMethod: () => 'custom-value',
        anotherMethod: (value: string) => `processed-${value}`,
      }))

      expect(extendedClient.customMethod()).toBe('custom-value')
      expect(extendedClient.anotherMethod('test')).toBe('processed-test')

      // Should preserve original functionality
      expect(extendedClient.config.integrator).toBe('test-app')
      expect(extendedClient.providers).toEqual([])
    })

    it('should allow chaining multiple extensions', () => {
      const client = createClient({ integrator: 'test-app' })

      const extendedClient = (client as any)
        .extend((_baseClient: any) => ({
          firstExtension: () => 'first',
        }))
        .extend((_baseClient: any) => ({
          secondExtension: () => 'second',
        }))

      expect(extendedClient.firstExtension()).toBe('first')
      expect(extendedClient.secondExtension()).toBe('second')
      expect(extendedClient.config.integrator).toBe('test-app')
    })

    it('should preserve extend function after extension', () => {
      const client = createClient({ integrator: 'test-app' })

      const extendedClient = (client as any).extend((_baseClient: any) => ({
        customMethod: () => 'custom-value',
      }))

      expect(typeof extendedClient.extend).toBe('function')

      const doubleExtendedClient = extendedClient.extend(
        (_baseClient: any) => ({
          anotherMethod: () => 'another-value',
        })
      )

      expect(doubleExtendedClient.customMethod()).toBe('custom-value')
      expect(doubleExtendedClient.anotherMethod()).toBe('another-value')
    })
  })

  describe('error handling', () => {
    it('should handle storage errors gracefully', async () => {
      // Mock storage to throw error
      const { getClientStorage } = await import('./getClientStorage.js')
      vi.mocked(getClientStorage).mockReturnValueOnce({
        needReset: false,
        getChains: vi.fn().mockRejectedValue(new Error('Storage error')),
        getRpcUrls: vi.fn().mockRejectedValue(new Error('Storage error')),
        setChains: vi.fn(),
      })

      const newClient = createClient({ integrator: 'test-app' })

      await expect(newClient.getChains()).rejects.toThrow('Storage error')
      await expect(newClient.getRpcUrls()).rejects.toThrow('Storage error')
    })
  })
})
