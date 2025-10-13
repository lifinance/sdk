import { findDefaultToken } from '@lifi/data-types'
import type { Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../core/client/createClient.js'
import { getTokenBalancesByChain } from './getTokenBalancesByChain.js'

const client = createClient({
  integrator: 'lifi-sdk',
})

const mockedGetTokenBalancesForChains = vi.spyOn(
  await import('./getTokenBalancesByChain.js'),
  'getTokenBalancesByChain'
)

describe('getTokenBalancesByChain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const SOME_TOKEN = {
    ...findDefaultToken(CoinKey.USDC, ChainId.DAI),
    priceUSD: '',
  }
  const SOME_WALLET_ADDRESS = 'some wallet address'

  describe('user input is invalid', () => {
    it('should throw Error because of missing walletAddress', async () => {
      await expect(
        getTokenBalancesByChain(client, '', {
          [ChainId.DAI]: [SOME_TOKEN],
        })
      ).rejects.toThrow('Missing walletAddress.')
    })

    it('should throw Error because of an invalid token', async () => {
      await expect(
        getTokenBalancesByChain(client, SOME_WALLET_ADDRESS, {
          [ChainId.DAI]: [{ not: 'a token' } as unknown as Token],
        })
      ).rejects.toThrow('Invalid tokens passed.')
    })

    it('should return empty token list as it is', async () => {
      mockedGetTokenBalancesForChains.mockReturnValue(Promise.resolve([]))

      const result = await getTokenBalancesByChain(
        client,
        SOME_WALLET_ADDRESS,
        {
          [ChainId.DAI]: [],
        }
      )

      expect(result).toEqual([])
      expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(1)
    })
  })

  describe('user input is valid', () => {
    it('should call the balance service', async () => {
      const balanceResponse = {
        [ChainId.DAI]: [
          {
            ...SOME_TOKEN,
            amount: 123n,
            blockNumber: 1n,
          },
        ],
      }

      mockedGetTokenBalancesForChains.mockReturnValue(
        Promise.resolve(balanceResponse)
      )

      const result = await getTokenBalancesByChain(
        client,
        SOME_WALLET_ADDRESS,
        {
          [ChainId.DAI]: [SOME_TOKEN],
        }
      )

      expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(1)
      expect(result).toEqual(balanceResponse)
    })
  })

  describe('provider is not the same as the chain type', () => {
    it('should return the tokens as is', async () => {
      const balanceResponse = {
        [ChainId.DAI]: [SOME_TOKEN],
      }

      mockedGetTokenBalancesForChains.mockReturnValue(
        Promise.resolve(balanceResponse)
      )

      const result = await getTokenBalancesByChain(
        client,
        SOME_WALLET_ADDRESS,
        {
          [ChainId.DAI]: [SOME_TOKEN],
        }
      )

      expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(1)
      expect(result).toEqual(balanceResponse)
    })
  })
})
