import { findDefaultToken } from '@lifi/data-types'
import {
  ChainId,
  CoinKey,
  createClient,
  type SDKClient,
  type StaticToken,
  type Token,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { getBitcoinBalance } from './getBitcoinBalance.js'

const client = createClient({
  integrator: 'lifi-sdk',
})

const defaultWalletAddress = 'bc1q5hx26klsnyqqc9255vuh0s96guz79x0cc54896'

const retryTimes = 2
const timeout = 10000

describe('getBitcoinBalance integration tests', () => {
  const loadAndCompareTokenAmounts = async (
    client: SDKClient,
    walletAddress: string,
    tokens: StaticToken[]
  ) => {
    const tokenBalances = await getBitcoinBalance(
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

      await loadAndCompareTokenAmounts(client, walletAddress, tokens)
    }
  )
})
