import { findDefaultToken } from '@lifi/data-types'
import type { StaticToken, Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment } from '../../../tests/setup.js'
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
})
