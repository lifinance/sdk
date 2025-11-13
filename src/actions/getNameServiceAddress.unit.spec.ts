import type { ChainType } from '@lifi/types'
import { describe, expect, it, vi } from 'vitest'
import { EVM } from '../core/EVM/EVM.js'
import { Solana } from '../core/Solana/Solana.js'
import { UTXO } from '../core/UTXO/UTXO.js'
import { client } from './actions.unit.handlers.js'
import { getNameServiceAddress } from './getNameServiceAddress.js'

describe('getNameServiceAddress', () => {
  describe('success scenarios', () => {
    it('should resolve address successfully with single provider', async () => {
      const mockResolveAddress = vi
        .fn()
        .mockResolvedValue('0x1234567890123456789012345678901234567890')

      const provider = EVM({ getWalletClient: vi.fn() })
      vi.spyOn(provider, 'resolveAddress').mockImplementation(
        mockResolveAddress
      )

      client.setProviders([provider])

      const result = await getNameServiceAddress(client, 'test.eth')

      expect(result).toBe('0x1234567890123456789012345678901234567890')
      expect(mockResolveAddress).toHaveBeenCalledWith('test.eth', client)
    })

    it('should resolve address successfully with multiple providers', async () => {
      const mockResolveAddress1 = vi
        .fn()
        .mockResolvedValue('0x1111111111111111111111111111111111111111')
      const mockResolveAddress2 = vi
        .fn()
        .mockResolvedValue('0x2222222222222222222222222222222222222222')

      const provider1 = EVM({ getWalletClient: vi.fn() })
      const provider2 = Solana({ getWalletAdapter: vi.fn() })

      vi.spyOn(provider1, 'resolveAddress').mockImplementation(
        mockResolveAddress1
      )
      vi.spyOn(provider2, 'resolveAddress').mockImplementation(
        mockResolveAddress2
      )

      client.setProviders([provider1, provider2])

      const result = await getNameServiceAddress(client, 'test.sol')

      // Should return the first successful result
      expect(result).toBe('0x1111111111111111111111111111111111111111')
      expect(mockResolveAddress1).toHaveBeenCalledWith('test.sol', client)
    })

    it('should resolve address with specific chain type', async () => {
      const mockResolveAddress = vi
        .fn()
        .mockResolvedValue('0x1234567890123456789012345678901234567890')

      const evmProvider = EVM({ getWalletClient: vi.fn() })
      const svmProvider = Solana({ getWalletAdapter: vi.fn() })

      vi.spyOn(evmProvider, 'resolveAddress').mockImplementation(
        mockResolveAddress
      )

      client.setProviders([evmProvider, svmProvider])

      const result = await getNameServiceAddress(
        client,
        'test.eth',
        'EVM' as ChainType
      )

      expect(result).toBe('0x1234567890123456789012345678901234567890')
      expect(mockResolveAddress).toHaveBeenCalledWith('test.eth', client)
    })
  })

  describe('chain type filtering', () => {
    it('should filter providers by chain type', async () => {
      const mockResolveAddress = vi
        .fn()
        .mockResolvedValue('0x1234567890123456789012345678901234567890')

      const evmProvider = EVM({ getWalletClient: vi.fn() })
      const svmProvider = Solana({ getWalletAdapter: vi.fn() })
      const utxoProvider = UTXO({ getWalletClient: vi.fn() })

      vi.spyOn(evmProvider, 'resolveAddress').mockImplementation(
        mockResolveAddress
      )

      client.setProviders([evmProvider, svmProvider, utxoProvider])

      const result = await getNameServiceAddress(
        client,
        'test.eth',
        'EVM' as ChainType
      )

      expect(result).toBe('0x1234567890123456789012345678901234567890')
      expect(mockResolveAddress).toHaveBeenCalledWith('test.eth', client)
    })

    it('should return undefined when no providers match chain type', async () => {
      const mockResolveAddress = vi
        .fn()
        .mockResolvedValue('0x1234567890123456789012345678901234567890')
      const evmProvider = EVM({ getWalletClient: vi.fn() })
      client.setProviders([evmProvider])

      const result = await getNameServiceAddress(
        client,
        'test.name',
        'SVM' as ChainType
      )

      expect(result).toBeUndefined()
      expect(mockResolveAddress).not.toHaveBeenCalled()
    })
  })

  describe('error scenarios', () => {
    it('should handle mixed success and failure scenarios', async () => {
      const mockResolveAddress1 = vi
        .fn()
        .mockRejectedValue(new Error('Provider 1 failed'))
      const mockResolveAddress2 = vi
        .fn()
        .mockResolvedValue('0x2222222222222222222222222222222222222222')
      const mockResolveAddress3 = vi.fn().mockResolvedValue(undefined)

      const provider1 = EVM({ getWalletClient: vi.fn() })
      const provider2 = Solana({ getWalletAdapter: vi.fn() })
      const provider3 = UTXO({ getWalletClient: vi.fn() })

      vi.spyOn(provider1, 'resolveAddress').mockImplementation(
        mockResolveAddress1
      )
      vi.spyOn(provider2, 'resolveAddress').mockImplementation(
        mockResolveAddress2
      )
      vi.spyOn(provider3, 'resolveAddress').mockImplementation(
        mockResolveAddress3
      )

      client.setProviders([provider1, provider2, provider3])

      const result = await getNameServiceAddress(client, 'test.name')

      // Should return the first successful result (provider2)
      expect(result).toBe('0x2222222222222222222222222222222222222222')
    })
  })
})
