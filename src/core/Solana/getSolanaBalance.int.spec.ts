import type { StaticToken, Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { findDefaultToken } from '../../../tests/tokens.js'
import { getSolanaBalance } from './getSolanaBalance.js'

const defaultWalletAddress = 'S5ARSDD3ddZqqqqqb2EUE2h2F1XQHBk7bErRW1WPGe4'

const retryTimes = 2
const timeout = 10000

beforeAll(setupTestEnvironment)

describe.sequential('Solana token balance', async () => {
  const loadAndCompareTokenAmounts = async (
    walletAddress: string,
    tokens: StaticToken[]
  ) => {
    const tokenBalances = await getSolanaBalance(
      walletAddress,
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
    'should handle empty lists',
    async () => {
      const walletAddress = defaultWalletAddress
      const tokens: Token[] = []
      await loadAndCompareTokenAmounts(walletAddress, tokens)
    },
    { retry: retryTimes, timeout }
  )

  it(
    'should work for stables on SOL',
    async () => {
      const walletAddress = defaultWalletAddress
      const tokens = [
        findDefaultToken(CoinKey.USDC, ChainId.SOL),
        findDefaultToken(CoinKey.USDT, ChainId.SOL),
        findDefaultToken(CoinKey.SOL, ChainId.SOL),
      ]

      await loadAndCompareTokenAmounts(walletAddress, tokens)
    },
    { retry: retryTimes, timeout }
  )

  it(
    'should return even with invalid data on POL',
    async () => {
      const walletAddress = defaultWalletAddress
      const invalidToken = findDefaultToken(CoinKey.MATIC, ChainId.SOL)
      invalidToken.address = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'
      const tokens = [findDefaultToken(CoinKey.USDC, ChainId.SOL), invalidToken]

      const tokenBalances = await getSolanaBalance(
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
    },
    { retry: retryTimes, timeout }
  )
})
