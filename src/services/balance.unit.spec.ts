import { findDefaultToken } from '@lifi/data-types'
import type { Token, WalletTokenExtended } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as balance from './balance.js'

const mockedGetTokenBalance = vi.spyOn(balance, 'getTokenBalance')
const mockedGetTokenBalances = vi.spyOn(balance, 'getTokenBalances')
const mockedGetTokenBalancesForChains = vi.spyOn(
  balance,
  'getTokenBalancesByChain'
)
const mockedGetWalletBalances = vi.spyOn(balance, 'getWalletBalances')

describe('Balance service tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  const SOME_TOKEN = {
    ...findDefaultToken(CoinKey.USDC, ChainId.DAI),
    priceUSD: '',
  }
  const SOME_WALLET_ADDRESS = 'some wallet address'

  describe('getTokenBalance', () => {
    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(balance.getTokenBalance('', SOME_TOKEN)).rejects.toThrow(
          'Missing walletAddress.'
        )
      })

      it('should throw Error because of invalid token', async () => {
        await expect(
          balance.getTokenBalance(SOME_WALLET_ADDRESS, {
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

        const result = await balance.getTokenBalance(
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
        await expect(
          balance.getTokenBalances('', [SOME_TOKEN])
        ).rejects.toThrow('Missing walletAddress.')
      })

      it('should throw Error because of an invalid token', async () => {
        await expect(
          balance.getTokenBalances(SOME_WALLET_ADDRESS, [
            SOME_TOKEN,
            { not: 'a token' } as unknown as Token,
          ])
        ).rejects.toThrow('Invalid tokens passed.')
      })

      it('should return empty token list as it is', async () => {
        mockedGetTokenBalances.mockReturnValue(Promise.resolve([]))
        const result = await balance.getTokenBalances(SOME_WALLET_ADDRESS, [])
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

        const result = await balance.getTokenBalances(SOME_WALLET_ADDRESS, [
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
          balance.getTokenBalancesByChain('', { [ChainId.DAI]: [SOME_TOKEN] })
        ).rejects.toThrow('Missing walletAddress.')
      })

      it('should throw Error because of an invalid token', async () => {
        await expect(
          balance.getTokenBalancesByChain(SOME_WALLET_ADDRESS, {
            [ChainId.DAI]: [{ not: 'a token' } as unknown as Token],
          })
        ).rejects.toThrow('Invalid tokens passed.')
      })

      it('should return empty token list as it is', async () => {
        mockedGetTokenBalancesForChains.mockReturnValue(Promise.resolve([]))

        const result = await balance.getTokenBalancesByChain(
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

        const result = await balance.getTokenBalancesByChain(
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

        const result = await balance.getTokenBalancesByChain(
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

  describe('getWalletBalances', () => {
    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(balance.getWalletBalances('')).rejects.toThrow(
          'Missing walletAddress.'
        )
      })
    })

    describe('user input is valid', () => {
      it('should call the balance service without options', async () => {
        const balanceResponse: Record<number, WalletTokenExtended[]> = {
          [ChainId.DAI]: [
            {
              ...SOME_TOKEN,
              amount: 123,
              marketCapUSD: 1000000,
              volumeUSD24H: 50000,
              fdvUSD: 2000000,
            },
          ],
        }

        mockedGetWalletBalances.mockReturnValue(
          Promise.resolve(balanceResponse)
        )

        const result = await balance.getWalletBalances(SOME_WALLET_ADDRESS)

        expect(mockedGetWalletBalances).toHaveBeenCalledTimes(1)
        expect(mockedGetWalletBalances).toHaveBeenCalledWith(
          SOME_WALLET_ADDRESS
        )
        expect(result).toEqual(balanceResponse)
      })

      it('should call the balance service with options', async () => {
        const balanceResponse: Record<number, WalletTokenExtended[]> = {
          [ChainId.DAI]: [
            {
              ...SOME_TOKEN,
              amount: 123,
              marketCapUSD: 1000000,
              volumeUSD24H: 50000,
              fdvUSD: 2000000,
            },
          ],
        }

        const options = { signal: new AbortController().signal }

        mockedGetWalletBalances.mockReturnValue(
          Promise.resolve(balanceResponse)
        )

        const result = await balance.getWalletBalances(
          SOME_WALLET_ADDRESS,
          options
        )

        expect(mockedGetWalletBalances).toHaveBeenCalledTimes(1)
        expect(mockedGetWalletBalances).toHaveBeenCalledWith(
          SOME_WALLET_ADDRESS,
          options
        )
        expect(result).toEqual(balanceResponse)
      })
    })
  })
})
