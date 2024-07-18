import type { StaticToken, Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { findDefaultToken } from '../../../tests/tokens.js'
import { getSolanaBalance } from './getSolanaBalance.js'

const defaultWalletAddress = '6AUWsSCRFSCbrHKH9s84wfzJXtD6mNzAHs11x6pGEcmJ'

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
      ]

      await loadAndCompareTokenAmounts(walletAddress, tokens)
    },
    { retry: retryTimes, timeout }
  )

  it(
    'should return even with invalid data',
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

  // it(
  //   'should execute route',
  //   async () => {
  //     const quote = await getQuote({
  //       fromChain: ChainId.SOL,
  //       fromAmount: '1000000',
  //       fromToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  //       toChain: ChainId.ARB,
  //       toToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  //       fromAddress: '6AUWsSCRFSCbrHKH9s84wfzJXtD6mNzAHs11x6pGEcmJ',
  //       toAddress: '0x29DaCdF7cCaDf4eE67c923b4C22255A4B2494eD7',
  //     })

  //     console.log(quote)

  //     await executeRoute(convertQuoteToRoute(quote), {
  //       updateRouteHook: (route) => {
  //         console.log(route.steps?.[0].execution)
  //       },
  //     })
  //   },
  //   { timeout: 100000000 }
  // )
})
