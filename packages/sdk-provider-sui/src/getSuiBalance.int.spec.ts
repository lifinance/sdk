import { findDefaultToken } from '@lifi/data-types'
import {
  ChainId,
  CoinKey,
  createClient,
  type StaticToken,
  type Token,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { getSuiBalance } from './getSuiBalance.js'

const client = createClient({
  integrator: 'lifi-sdk',
})

const defaultWalletAddress =
  '0xd2fdd62880764fa73b895a9824ecec255a4bd9d654a125e58de33088cbf5eb67'

const retryTimes = 2
const timeout = 10000

describe.sequential('Sui token balance', async () => {
  const loadAndCompareTokenAmounts = async (
    walletAddress: string,
    tokens: StaticToken[]
  ) => {
    const tokenBalances = await getSuiBalance(
      client,
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
      expect(tokenBalance.amount).toBeGreaterThanOrEqual(0n)

      // contain block number
      expect(tokenBalance.blockNumber).toBeDefined()
      expect(tokenBalance.blockNumber).toBeGreaterThan(0)
    }
  }

  it('should handle empty lists', { retry: retryTimes, timeout }, async () => {
    const walletAddress = defaultWalletAddress
    const tokens: Token[] = []
    await loadAndCompareTokenAmounts(walletAddress, tokens)
  })

  it(
    'should work for native SUI token',
    { retry: retryTimes, timeout },
    async () => {
      const walletAddress = defaultWalletAddress
      const tokens = [
        findDefaultToken(CoinKey.SUI, ChainId.SUI),
        findDefaultToken(CoinKey.USDC, ChainId.SUI),
      ]

      await loadAndCompareTokenAmounts(walletAddress, tokens)
    }
  )

  it(
    'should return even with invalid data',
    { retry: retryTimes, timeout },
    async () => {
      const walletAddress = defaultWalletAddress
      const invalidToken = findDefaultToken(CoinKey.USDT, ChainId.SUI)
      invalidToken.address = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'
      const tokens = [findDefaultToken(CoinKey.SUI, ChainId.SUI), invalidToken]

      const tokenBalances = await getSuiBalance(
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
})
