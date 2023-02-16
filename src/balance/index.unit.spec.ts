import { ChainId, CoinKey, findDefaultToken, Token } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTokenBalance, getTokenBalances, getTokenBalancesForChains } from '.'
import utils from './utils'

vi.mock('./utils', () => ({
  default: {
    getBalances: vi.fn(() => Promise.resolve([])),
  },
}))

const mockedGetBalances = vi.spyOn(utils, 'getBalances')

const defaultWalletAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'

describe('balances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getTokenBalance', () => {
    it('should load a token', async () => {
      const token = findDefaultToken(CoinKey.WETH, ChainId.ETH)
      getTokenBalance(defaultWalletAddress, token)
      expect(mockedGetBalances).toHaveBeenCalledTimes(1)
    })
  })

  describe('getTokenBalances', () => {
    it('should handle emty list', async () => {
      const tokens: Token[] = []
      const result = await getTokenBalances(defaultWalletAddress, tokens)
      expect(result).toEqual([])
      expect(mockedGetBalances).toHaveBeenCalledTimes(0)
    })

    it('should load mutliple token in one request', async () => {
      const tokens = [
        findDefaultToken(CoinKey.WETH, ChainId.ETH),
        findDefaultToken(CoinKey.USDC, ChainId.ETH),
      ]
      getTokenBalances(defaultWalletAddress, tokens)
      expect(mockedGetBalances).toHaveBeenCalledTimes(1)
    })

    it('should load tokens in one request per chain', () => {
      const tokens = [
        findDefaultToken(CoinKey.WETH, ChainId.ETH),
        findDefaultToken(CoinKey.USDC, ChainId.POL),
        findDefaultToken(CoinKey.DAI, ChainId.POL),
      ]
      getTokenBalances(defaultWalletAddress, tokens)
      expect(mockedGetBalances).toHaveBeenCalledTimes(2)
    })
  })

  describe('getTokenBalancesForChains', () => {
    it('should handle empty list', () => {
      const tokensByChain = {
        [ChainId.ETH]: [],
        [ChainId.POL]: [],
      }
      getTokenBalancesForChains(defaultWalletAddress, tokensByChain)
      expect(mockedGetBalances).toHaveBeenCalledTimes(2)
    })

    it('should handle partly empty list', () => {
      const tokensByChain = {
        [ChainId.ETH]: [],
        [ChainId.POL]: [
          findDefaultToken(CoinKey.USDC, ChainId.POL),
          findDefaultToken(CoinKey.MATIC, ChainId.POL),
        ],
      }
      getTokenBalancesForChains(defaultWalletAddress, tokensByChain)
      expect(mockedGetBalances).toHaveBeenCalledTimes(2)
    })

    it('should load tokens in one request per chain', () => {
      const tokensByChain = {
        [ChainId.ETH]: [findDefaultToken(CoinKey.WETH, ChainId.ETH)],
        [ChainId.POL]: [
          findDefaultToken(CoinKey.USDC, ChainId.POL),
          findDefaultToken(CoinKey.MATIC, ChainId.POL),
        ],
      }
      getTokenBalancesForChains(defaultWalletAddress, tokensByChain)
      expect(mockedGetBalances).toHaveBeenCalledTimes(2)
    })
  })
})
