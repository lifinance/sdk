import type { Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findDefaultToken } from '../../tests/tokens.js'
import * as getBalance from './getBalance.js'
import {
  getTokenBalance,
  getTokenBalances,
  getTokenBalancesByChain,
} from './getTokenBalance.js'

vi.mock('./getBalance', () => ({
  getBalance: vi.fn(() => Promise.resolve([])),
}))

const mockedGetBalances = vi.spyOn(getBalance, 'getBalance')

const defaultWalletAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'

describe('balances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getTokenBalance', () => {
    it('should load a token', async () => {
      const token = findDefaultToken(CoinKey.USDC, ChainId.ETH)
      getTokenBalance(defaultWalletAddress, token as Token)
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
        findDefaultToken(CoinKey.USDT, ChainId.ETH),
        findDefaultToken(CoinKey.USDC, ChainId.ETH),
      ]
      getTokenBalances(defaultWalletAddress, tokens as Token[])
      expect(mockedGetBalances).toHaveBeenCalledTimes(1)
    })

    it('should load tokens in one request per chain', () => {
      const tokens = [
        findDefaultToken(CoinKey.USDT, ChainId.ETH),
        findDefaultToken(CoinKey.USDC, ChainId.POL),
        findDefaultToken(CoinKey.DAI, ChainId.POL),
      ]
      getTokenBalances(defaultWalletAddress, tokens as Token[])
      expect(mockedGetBalances).toHaveBeenCalledTimes(2)
    })
  })

  describe('getTokenBalancesForChains', () => {
    it('should handle empty list', () => {
      const tokensByChain = {
        [ChainId.ETH]: [],
        [ChainId.POL]: [],
      }
      getTokenBalancesByChain(defaultWalletAddress, tokensByChain)
      expect(mockedGetBalances).toHaveBeenCalledTimes(2)
    })

    it('should handle partly empty list', () => {
      const tokensByChain = {
        [ChainId.ETH]: [],
        [ChainId.POL]: [
          findDefaultToken(CoinKey.USDC, ChainId.POL) as Token,
          findDefaultToken(CoinKey.MATIC, ChainId.POL) as Token,
        ],
      }
      getTokenBalancesByChain(defaultWalletAddress, tokensByChain)
      expect(mockedGetBalances).toHaveBeenCalledTimes(2)
    })

    it('should load tokens in one request per chain', () => {
      const tokensByChain = {
        [ChainId.ETH]: [findDefaultToken(CoinKey.USDT, ChainId.ETH) as Token],
        [ChainId.POL]: [
          findDefaultToken(CoinKey.USDC, ChainId.POL) as Token,
          findDefaultToken(CoinKey.MATIC, ChainId.POL) as Token,
        ],
      }
      getTokenBalancesByChain(defaultWalletAddress, tokensByChain)
      expect(mockedGetBalances).toHaveBeenCalledTimes(2)
    })
  })
})
