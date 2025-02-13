import type { StaticToken, Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { findDefaultToken } from '../../../tests/tokens.js'
import { getUTXOBalance } from './getUTXOBalance.js'

const defaultWalletAddress = 'bc1q5hx26klsnyqqc9255vuh0s96guz79x0cc54896'

const retryTimes = 2
const timeout = 10000

beforeAll(setupTestEnvironment)

describe('getBalances integration tests', () => {
  const loadAndCompareTokenAmounts = async (
    walletAddress: string,
    tokens: StaticToken[]
  ) => {
    const tokenBalances = await getUTXOBalance(walletAddress, tokens as Token[])

    expect(tokenBalances.length).toEqual(tokens.length)

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const tokenBalance = tokenBalances[i]

      // contain token properties
      expect(token.address).toEqual(tokenBalance.address)

      // set amount
      expect(tokenBalance.amount).toBeDefined()
      expect(tokenBalance.amount).toBeGreaterThanOrEqual(0)

      // contain block number
      expect(tokenBalance.blockNumber).toBeDefined()
      expect(tokenBalance.blockNumber).toBeGreaterThan(0)
    }
  }

  it(
    'should work for ERC20 on POL',
    { retry: retryTimes, timeout },
    async () => {
      const walletAddress = defaultWalletAddress
      const tokens = [
        findDefaultToken(CoinKey.USDC, ChainId.POL),
        findDefaultToken(CoinKey.USDT, ChainId.POL),
      ]

      await loadAndCompareTokenAmounts(walletAddress, tokens)
    }
  )

  // it(
  //   'should work for MATIC on POL',
  //   async () => {
  //     const walletAddress = defaultWalletAddress
  //     const tokens = [
  //       findDefaultToken(CoinKey.MATIC, ChainId.POL),
  //       findDefaultToken(CoinKey.DAI, ChainId.POL),
  //     ]

  //     await loadAndCompareTokenAmounts(walletAddress, tokens)
  //   },
  //   { retry: retryTimes, timeout }
  // )

  // it(
  //   'should return even with invalid data on POL',
  //   async () => {
  //     const walletAddress = defaultWalletAddress
  //     const invalidToken = findDefaultToken(CoinKey.MATIC, ChainId.POL)
  //     invalidToken.address = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'
  //     const tokens = [findDefaultToken(CoinKey.USDC, ChainId.POL), invalidToken]

  //     const tokenBalances = await getUTXOBalance(
  //       walletAddress,
  //       tokens as Token[]
  //     )
  //     expect(tokenBalances.length).toBe(2)

  //     // invalid tokens should be returned with balance 0
  //     const invalidBalance = tokenBalances.find(
  //       (token) => token.address === invalidToken.address
  //     )
  //     expect(invalidBalance).toBeDefined()
  //     expect(invalidBalance!.amount).toBeUndefined()
  //   },
  //   { retry: retryTimes, timeout }
  // )

  // it(
  //   'should fallback to a direct call if only one token is requested',
  //   async () => {
  //     const walletAddress = defaultWalletAddress
  //     const tokens = [findDefaultToken(CoinKey.DAI, ChainId.BSC)]
  //     await loadAndCompareTokenAmounts(walletAddress, tokens)
  //   },
  //   { retry: retryTimes, timeout }
  // )

  // it(
  //   'should handle empty lists',
  //   async () => {
  //     const walletAddress = defaultWalletAddress
  //     const tokens: Token[] = []
  //     await loadAndCompareTokenAmounts(walletAddress, tokens)
  //   },
  //   { retry: retryTimes, timeout }
  // )

  // it(
  //   'should handle token lists with more than 100 tokens',
  //   async () => {
  //     const walletAddress = defaultWalletAddress
  //     const { tokens } = await getTokens({
  //       chains: [ChainId.OPT],
  //     })
  //     expect(tokens[ChainId.OPT]?.length).toBeGreaterThan(100)
  //     if (tokens[ChainId.OPT]?.length) {
  //       await loadAndCompareTokenAmounts(
  //         walletAddress,
  //         tokens[ChainId.OPT].slice(0, 150)
  //       ) // chunk limit is 100
  //     }
  //   },
  //   { retry: retryTimes, timeout }
  // )
})
