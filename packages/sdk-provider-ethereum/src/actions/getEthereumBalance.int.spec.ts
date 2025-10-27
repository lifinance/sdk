import { findDefaultToken } from '@lifi/data-types'
import {
  ChainId,
  CoinKey,
  createClient,
  getTokens,
  type StaticToken,
  type Token,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { getEthereumBalance } from './getEthereumBalance.js'

const client = createClient({
  integrator: 'lifi-sdk',
})

const defaultWalletAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'

const retryTimes = 2
const timeout = 10000

describe('getBalances integration tests', () => {
  const loadAndCompareTokenAmounts = async (
    walletAddress: string,
    tokens: StaticToken[]
  ) => {
    const tokenBalances = await getEthereumBalance(
      client,
      walletAddress as Address,
      tokens as Token[]
    )

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

  it(
    'should work for MATIC on POL',
    { retry: retryTimes, timeout },
    async () => {
      const walletAddress = defaultWalletAddress
      const tokens = [
        findDefaultToken(CoinKey.POL, ChainId.POL),
        findDefaultToken(CoinKey.DAI, ChainId.POL),
      ]

      await loadAndCompareTokenAmounts(walletAddress, tokens)
    }
  )

  it(
    'should return even with invalid data on POL',
    { retry: retryTimes, timeout },
    async () => {
      const walletAddress = defaultWalletAddress
      const invalidToken = findDefaultToken(CoinKey.POL, ChainId.POL)
      invalidToken.address = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'
      const tokens = [findDefaultToken(CoinKey.USDC, ChainId.POL), invalidToken]
      const tokenBalances = await getEthereumBalance(
        client,
        walletAddress,
        tokens as Token[]
      )
      expect(tokenBalances.length).toBe(2)

      // invalid tokens should be returned with balance 0
      const invalidBalance = tokenBalances.find(
        (token) => token.address === invalidToken.address
      )
      expect(invalidBalance).toBeDefined()
      expect(invalidBalance!.amount).toBeUndefined()
    }
  )

  it(
    'should fallback to a direct call if only one token is requested',
    { retry: retryTimes, timeout },
    async () => {
      const walletAddress = defaultWalletAddress
      const tokens = [findDefaultToken(CoinKey.DAI, ChainId.BSC)]
      await loadAndCompareTokenAmounts(walletAddress, tokens)
    }
  )

  it('should handle empty lists', { retry: retryTimes, timeout }, async () => {
    const walletAddress = defaultWalletAddress
    const tokens: Token[] = []
    await loadAndCompareTokenAmounts(walletAddress, tokens)
  })

  it(
    'should handle token lists with more than 100 tokens',
    { retry: retryTimes, timeout },
    async () => {
      const walletAddress = defaultWalletAddress
      const { tokens } = await getTokens(client, {
        chains: [ChainId.OPT],
      })
      expect(tokens[ChainId.OPT]?.length).toBeGreaterThan(100)
      if (tokens[ChainId.OPT]?.length) {
        await loadAndCompareTokenAmounts(
          walletAddress,
          tokens[ChainId.OPT].slice(0, 150)
        ) // chunk limit is 100
      }
    }
  )
})
