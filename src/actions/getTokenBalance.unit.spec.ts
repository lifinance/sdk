import { findDefaultToken } from '@lifi/data-types'
import type { Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { client } from './actions.unit.handlers.js'
import { getTokenBalance } from './getTokenBalance.js'

const mockedGetTokenBalance = vi.spyOn(
  await import('./getTokenBalance.js'),
  'getTokenBalance'
)

describe('getTokenBalance', () => {
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
      await expect(getTokenBalance(client, '', SOME_TOKEN)).rejects.toThrow(
        'Missing walletAddress.'
      )
    })

    it('should throw Error because of invalid token', async () => {
      await expect(
        getTokenBalance(client, SOME_WALLET_ADDRESS, {
          address: 'some wrong stuff',
          chainId: 'not a chain Id',
        } as unknown as Token)
      ).rejects.toThrow('Invalid tokens passed.')
    })
  })

  describe('user input is valid', () => {
    it('should call the balance service', async () => {
      const balanceResponse = {
        ...SOME_TOKEN,
        amount: 123n,
        blockNumber: 1n,
      }

      mockedGetTokenBalance.mockReturnValue(Promise.resolve(balanceResponse))

      const result = await getTokenBalance(
        client,
        SOME_WALLET_ADDRESS,
        SOME_TOKEN
      )

      expect(mockedGetTokenBalance).toHaveBeenCalledTimes(1)
      expect(result).toEqual(balanceResponse)
    })
  })
})
