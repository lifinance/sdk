import { ChainId, CoinKey, findDefaultToken, Token } from '@lifinance/types'
import BigNumber from 'bignumber.js'
import Lifi from '..'

import utils from './utils'

const defaultWalletAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'

jest.setTimeout(10000)

describe('balances utils', () => {
  describe('getBalances Integration Tests', () => {
    const loadAndCompareTokenAmounts = async (
      walletAddress: string,
      tokens: Token[]
    ) => {
      const tokenBalances = await utils.getBalances(walletAddress, tokens)

      expect(tokenBalances.length).toEqual(tokens.length)

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        const tokenBalance = tokenBalances[i]

        // contain token properties
        expect(token.address).toEqual(tokenBalance.address)

        // set amount
        expect(tokenBalance.amount).toBeDefined()
        expect(new BigNumber(tokenBalance.amount).gte(0)).toBeTruthy()

        // contain block number
        expect(tokenBalance.blockNumber).toBeDefined()
        expect(tokenBalance.blockNumber).toBeGreaterThan(0)
      }
    }

    it('should work for ERC20 on POL', async () => {
      const walletAddress = defaultWalletAddress
      const tokens = [
        findDefaultToken(CoinKey.USDC, ChainId.POL),
        findDefaultToken(CoinKey.USDT, ChainId.POL),
      ]

      await loadAndCompareTokenAmounts(walletAddress, tokens)
    })

    it('should work for MATIC on POL', async () => {
      const walletAddress = defaultWalletAddress
      const tokens = [
        findDefaultToken(CoinKey.MATIC, ChainId.POL),
        findDefaultToken(CoinKey.DAI, ChainId.POL),
      ]

      await loadAndCompareTokenAmounts(walletAddress, tokens)
    })

    it('should return empty array for invalid data on POL', async () => {
      const walletAddress = defaultWalletAddress
      const invalidToken = findDefaultToken(CoinKey.MATIC, ChainId.POL)
      invalidToken.address = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'
      const tokens = [findDefaultToken(CoinKey.USDC, ChainId.POL), invalidToken]

      const tokenBalances = await utils.getBalances(walletAddress, tokens)
      expect(tokenBalances.length).toBe(0)
    })

    it('should fallback to a direct call if only one token is requested', async () => {
      const walletAddress = defaultWalletAddress
      const tokens = [findDefaultToken(CoinKey.DAI, ChainId.BSC)]
      await loadAndCompareTokenAmounts(walletAddress, tokens)
    })

    it('should fallback to multiple calls if multicall in not available', async () => {
      const walletAddress = defaultWalletAddress
      const tokens = [
        findDefaultToken(CoinKey.ETH, ChainId.OPT),
        findDefaultToken(CoinKey.USDC, ChainId.OPT),
      ]
      await loadAndCompareTokenAmounts(walletAddress, tokens)
    })

    it('should handle empty lists', async () => {
      const walletAddress = defaultWalletAddress
      const tokens: Token[] = []
      await loadAndCompareTokenAmounts(walletAddress, tokens)
    })

    it('should handle token lists with more than 100 tokens', async () => {
      const walletAddress = defaultWalletAddress
      const { tokens } = await Lifi.getPossibilities()
      const ethTokens = tokens.filter((token) => token.chainId === ChainId.ETH) // > 1000 tokens on eth

      await loadAndCompareTokenAmounts(walletAddress, ethTokens.slice(0, 150)) // chunk limit is 100
    })
  })
})
