import { ChainId, CoinKey, findDefaultToken, Token } from '@lifi/types'
import balances from '.'
import utils from './utils'

jest.mock('./utils')
const mockedUtils = utils as jest.Mocked<typeof utils>

const defaultWalletAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'

describe('balances', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getTokenBalance', () => {
    it('should load a token', () => {
      mockedUtils.getBalances.mockReturnValue(Promise.resolve([]))
      const token = findDefaultToken(CoinKey.WETH, ChainId.ETH)
      balances.getTokenBalance(defaultWalletAddress, token)
      expect(mockedUtils.getBalances).toHaveBeenCalledTimes(1)
    })
  })

  describe('getTokenBalances', () => {
    it('should handle emty list', async () => {
      const tokens: Token[] = []
      const result = await balances.getTokenBalances(
        defaultWalletAddress,
        tokens
      )
      expect(result).toEqual([])
      expect(mockedUtils.getBalances).toHaveBeenCalledTimes(0)
    })

    it('should load mutliple token in one request', () => {
      mockedUtils.getBalances.mockReturnValue(Promise.resolve([]))
      const tokens = [
        findDefaultToken(CoinKey.WETH, ChainId.ETH),
        findDefaultToken(CoinKey.USDC, ChainId.ETH),
      ]
      balances.getTokenBalances(defaultWalletAddress, tokens)
      expect(mockedUtils.getBalances).toHaveBeenCalledTimes(1)
    })

    it('should load tokens in one request per chain', () => {
      mockedUtils.getBalances.mockReturnValue(Promise.resolve([]))
      const tokens = [
        findDefaultToken(CoinKey.WETH, ChainId.ETH),
        findDefaultToken(CoinKey.USDC, ChainId.POL),
        findDefaultToken(CoinKey.DAI, ChainId.POL),
      ]
      balances.getTokenBalances(defaultWalletAddress, tokens)
      expect(mockedUtils.getBalances).toHaveBeenCalledTimes(2)
    })
  })

  describe('getTokenBalancesForChains', () => {
    it('should handle empty list', () => {
      mockedUtils.getBalances.mockReturnValue(Promise.resolve([]))
      const tokensByChain = {
        [ChainId.ETH]: [],
        [ChainId.POL]: [],
      }
      balances.getTokenBalancesForChains(defaultWalletAddress, tokensByChain)
      expect(mockedUtils.getBalances).toHaveBeenCalledTimes(2)
    })

    it('should handle partly empty list', () => {
      mockedUtils.getBalances.mockReturnValue(Promise.resolve([]))
      const tokensByChain = {
        [ChainId.ETH]: [],
        [ChainId.POL]: [
          findDefaultToken(CoinKey.USDC, ChainId.POL),
          findDefaultToken(CoinKey.MATIC, ChainId.POL),
        ],
      }
      balances.getTokenBalancesForChains(defaultWalletAddress, tokensByChain)
      expect(mockedUtils.getBalances).toHaveBeenCalledTimes(2)
    })

    it('should load tokens in one request per chain', () => {
      mockedUtils.getBalances.mockReturnValue(Promise.resolve([]))
      const tokensByChain = {
        [ChainId.ETH]: [findDefaultToken(CoinKey.WETH, ChainId.ETH)],
        [ChainId.POL]: [
          findDefaultToken(CoinKey.USDC, ChainId.POL),
          findDefaultToken(CoinKey.MATIC, ChainId.POL),
        ],
      }
      balances.getTokenBalancesForChains(defaultWalletAddress, tokensByChain)
      expect(mockedUtils.getBalances).toHaveBeenCalledTimes(2)
    })
  })
})
