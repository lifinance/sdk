import { ChainId, CoinKey, findDefaultToken, Token } from '@lifi/types'
import * as balance from './balance'
import Lifi from './Lifi'

jest.mock('./balance')
const mockedBalances = balance as jest.Mocked<typeof balance>

let lifi: Lifi

describe('LIFI SDK', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    lifi = new Lifi()
  })

  describe('getTokenBalance', () => {
    const SOME_TOKEN = findDefaultToken(CoinKey.USDC, ChainId.DAI)
    const SOME_WALLET_ADDRESS = 'some wallet address'

    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(lifi.getTokenBalance('', SOME_TOKEN)).rejects.toThrow(
          'Missing walletAddress.'
        )

        expect(mockedBalances.getTokenBalance).toHaveBeenCalledTimes(0)
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

        expect(mockedBalances.getTokenBalance).toHaveBeenCalledTimes(0)
      })
    })

    describe('user input is valid', () => {
      it('should call the balance service', async () => {
        const balanceResponse = {
          ...SOME_TOKEN,
          amount: '123',
          blockNumber: 1,
        }

        mockedBalances.getTokenBalance.mockReturnValue(
          Promise.resolve(balanceResponse)
        )

        const result = await lifi.getTokenBalance(
          SOME_WALLET_ADDRESS,
          SOME_TOKEN
        )

        expect(mockedBalances.getTokenBalance).toHaveBeenCalledTimes(1)
        expect(result).toEqual(balanceResponse)
      })
    })
  })

  describe('getTokenBalances', () => {
    const SOME_TOKEN = findDefaultToken(CoinKey.USDC, ChainId.DAI)
    const SOME_WALLET_ADDRESS = 'some wallet address'

    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(lifi.getTokenBalances('', [SOME_TOKEN])).rejects.toThrow(
          'Missing walletAddress.'
        )

        expect(mockedBalances.getTokenBalances).toHaveBeenCalledTimes(0)
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

        expect(mockedBalances.getTokenBalances).toHaveBeenCalledTimes(0)
      })

      it('should return empty token list as it is', async () => {
        mockedBalances.getTokenBalances.mockReturnValue(Promise.resolve([]))
        const result = await lifi.getTokenBalances(SOME_WALLET_ADDRESS, [])
        expect(result).toEqual([])
        expect(mockedBalances.getTokenBalances).toHaveBeenCalledTimes(1)
      })
    })

    describe('user input is valid', () => {
      it('should call the balance service', async () => {
        const balanceResponse = [
          {
            ...SOME_TOKEN,
            amount: '123',
            blockNumber: 1,
          },
        ]

        mockedBalances.getTokenBalances.mockReturnValue(
          Promise.resolve(balanceResponse)
        )

        const result = await lifi.getTokenBalances(SOME_WALLET_ADDRESS, [
          SOME_TOKEN,
        ])

        expect(mockedBalances.getTokenBalances).toHaveBeenCalledTimes(1)
        expect(result).toEqual(balanceResponse)
      })
    })
  })

  describe('getTokenBalancesForChains', () => {
    const SOME_TOKEN = findDefaultToken(CoinKey.USDC, ChainId.DAI)
    const SOME_WALLET_ADDRESS = 'some wallet address'

    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(
          lifi.getTokenBalancesForChains('', { [ChainId.DAI]: [SOME_TOKEN] })
        ).rejects.toThrow('Missing walletAddress.')

        expect(mockedBalances.getTokenBalancesForChains).toHaveBeenCalledTimes(
          0
        )
      })

      it('should throw Error because of an invalid token', async () => {
        await expect(
          lifi.getTokenBalancesForChains(SOME_WALLET_ADDRESS, {
            [ChainId.DAI]: [{ not: 'a token' } as unknown as Token],
          })
        ).rejects.toThrow(
          'Invalid token passed: address "undefined" on chainId "undefined"'
        )

        expect(mockedBalances.getTokenBalancesForChains).toHaveBeenCalledTimes(
          0
        )
      })

      it('should return empty token list as it is', async () => {
        mockedBalances.getTokenBalancesForChains.mockReturnValue(
          Promise.resolve([])
        )

        const result = await lifi.getTokenBalancesForChains(
          SOME_WALLET_ADDRESS,
          {
            [ChainId.DAI]: [],
          }
        )

        expect(result).toEqual([])
        expect(mockedBalances.getTokenBalancesForChains).toHaveBeenCalledTimes(
          1
        )
      })
    })

    describe('user input is valid', () => {
      it('should call the balance service', async () => {
        const balanceResponse = {
          [ChainId.DAI]: [
            {
              ...SOME_TOKEN,
              amount: '123',
              blockNumber: 1,
            },
          ],
        }

        mockedBalances.getTokenBalancesForChains.mockReturnValue(
          Promise.resolve(balanceResponse)
        )

        const result = await lifi.getTokenBalancesForChains(
          SOME_WALLET_ADDRESS,
          {
            [ChainId.DAI]: [SOME_TOKEN],
          }
        )

        expect(mockedBalances.getTokenBalancesForChains).toHaveBeenCalledTimes(
          1
        )
        expect(result).toEqual(balanceResponse)
      })
    })
  })
})
