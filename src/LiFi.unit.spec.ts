import type { Token } from '@lifi/types'
import { ChainId, CoinKey, findDefaultToken } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildStepObject } from '../test/fixtures'
import { LiFi } from './LiFi'
import * as balance from './balance'
import { convertQuoteToRoute } from './helpers'

vi.mock('./balance', () => ({
  getTokenBalancesByChain: vi.fn(() => Promise.resolve([])),
  getTokenBalance: vi.fn(() => Promise.resolve([])),
  getTokenBalances: vi.fn(() => Promise.resolve([])),
}))

const mockedGetTokenBalance = vi.spyOn(balance, 'getTokenBalance')
const mockedGetTokenBalances = vi.spyOn(balance, 'getTokenBalances')
const mockedGetTokenBalancesForChains = vi.spyOn(
  balance,
  'getTokenBalancesByChain'
)

let lifi: LiFi

describe('LIFI SDK', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lifi = new LiFi({
      integrator: 'test-example',
    })
  })

  const SOME_TOKEN = {
    ...findDefaultToken(CoinKey.USDC, ChainId.DAI),
    priceUSD: '',
  }
  const SOME_WALLET_ADDRESS = 'some wallet address'

  describe('getTokenBalance', () => {
    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(lifi.getTokenBalance('', SOME_TOKEN)).rejects.toThrow(
          'Missing walletAddress.'
        )

        expect(mockedGetTokenBalance).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of invalid token', async () => {
        await expect(
          lifi.getTokenBalance(SOME_WALLET_ADDRESS, {
            address: 'some wrong stuff',
            chainId: 'not a chain Id',
          } as unknown as Token)
        ).rejects.toThrow(
          'Invalid token passed: address "some wrong stuff" on chainId "not a chain Id"'
        )

        expect(mockedGetTokenBalance).toHaveBeenCalledTimes(0)
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

        const result = await lifi.getTokenBalance(
          SOME_WALLET_ADDRESS,
          SOME_TOKEN
        )

        expect(mockedGetTokenBalance).toHaveBeenCalledTimes(1)
        expect(result).toEqual(balanceResponse)
      })
    })
  })

  describe('getTokenBalances', () => {
    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(lifi.getTokenBalances('', [SOME_TOKEN])).rejects.toThrow(
          'Missing walletAddress.'
        )

        expect(mockedGetTokenBalances).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of an invalid token', async () => {
        await expect(
          lifi.getTokenBalances(SOME_WALLET_ADDRESS, [
            SOME_TOKEN,
            { not: 'a token' } as unknown as Token,
          ])
        ).rejects.toThrow(
          'Invalid token passed: address "undefined" on chainId "undefined"'
        )

        expect(mockedGetTokenBalances).toHaveBeenCalledTimes(0)
      })

      it('should return empty token list as it is', async () => {
        mockedGetTokenBalances.mockReturnValue(Promise.resolve([]))
        const result = await lifi.getTokenBalances(SOME_WALLET_ADDRESS, [])
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

        const result = await lifi.getTokenBalances(SOME_WALLET_ADDRESS, [
          SOME_TOKEN,
        ])

        expect(mockedGetTokenBalances).toHaveBeenCalledTimes(1)
        expect(result).toEqual(balanceResponse)
      })
    })
  })

  describe('getTokenBalancesForChains', () => {
    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(
          lifi.getTokenBalancesByChain('', { [ChainId.DAI]: [SOME_TOKEN] })
        ).rejects.toThrow('Missing walletAddress.')

        expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of an invalid token', async () => {
        await expect(
          lifi.getTokenBalancesByChain(SOME_WALLET_ADDRESS, {
            [ChainId.DAI]: [{ not: 'a token' } as unknown as Token],
          })
        ).rejects.toThrow(
          'Invalid token passed: address "undefined" on chainId "undefined"'
        )

        expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(0)
      })

      it('should return empty token list as it is', async () => {
        mockedGetTokenBalancesForChains.mockReturnValue(Promise.resolve([]))

        const result = await lifi.getTokenBalancesByChain(SOME_WALLET_ADDRESS, {
          [ChainId.DAI]: [],
        })

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

        const result = await lifi.getTokenBalancesByChain(SOME_WALLET_ADDRESS, {
          [ChainId.DAI]: [SOME_TOKEN],
        })

        expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(1)
        expect(result).toEqual(balanceResponse)
      })
    })
  })

  describe('Should convert Step to Route', () => {
    it('should convert Step to Route', () => {
      const mockStep = buildStepObject({
        includingExecution: true,
      })

      const convertedRoute = convertQuoteToRoute(mockStep)

      expect(convertedRoute.fromAmountUSD).toEqual(
        mockStep.estimate.fromAmountUSD
      )
    })
  })
})
