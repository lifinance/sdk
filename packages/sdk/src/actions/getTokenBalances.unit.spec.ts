import { findDefaultToken } from '@lifi/data-types'
import type { Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { client } from './actions.unit.handlers.js'
import { getTokenBalances } from './getTokenBalances.js'

const mockedGetTokenBalances = vi.spyOn(
  await import('./getTokenBalances.js'),
  'getTokenBalances'
)

describe('getTokenBalances', () => {
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
      await expect(getTokenBalances(client, '', [SOME_TOKEN])).rejects.toThrow(
        'Missing walletAddress.'
      )
    })

    it('should throw Error because of an invalid token', async () => {
      await expect(
        getTokenBalances(client, SOME_WALLET_ADDRESS, [
          SOME_TOKEN,
          { not: 'a token' } as unknown as Token,
        ])
      ).rejects.toThrow('Invalid tokens passed.')
    })

    it('should return empty token list as it is', async () => {
      mockedGetTokenBalances.mockReturnValue(Promise.resolve([]))
      const result = await getTokenBalances(client, SOME_WALLET_ADDRESS, [])
      expect(result).toEqual([])
      expect(mockedGetTokenBalances).toHaveBeenCalledTimes(1)
    })
  })

  describe('user input is valid', () => {
    it('should call the balance service', async () => {
      const balanceResponse = [
        {
          ...SOME_TOKEN,
          amount: 123n,
          blockNumber: 1n,
        },
      ]

      mockedGetTokenBalances.mockReturnValue(Promise.resolve(balanceResponse))

      const result = await getTokenBalances(client, SOME_WALLET_ADDRESS, [
        SOME_TOKEN,
      ])

      expect(mockedGetTokenBalances).toHaveBeenCalledTimes(1)
      expect(result).toEqual(balanceResponse)
    })
  })
})
