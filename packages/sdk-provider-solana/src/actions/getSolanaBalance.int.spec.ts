import { findDefaultToken } from '@lifi/data-types'
import {
  ChainId,
  CoinKey,
  createClient,
  type StaticToken,
  type Token,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { getSolanaBalance } from './getSolanaBalance.js'

const client = createClient({
  integrator: 'lifi-sdk',
})

const defaultWalletAddress = '9T655zHa6bYrTHWdy59NFqkjwoaSwfMat2yzixE1nb56'

const retryTimes = 2
const timeout = 10000

describe.sequential('Solana token balance', async () => {
  const loadAndCompareTokenAmounts = async (
    walletAddress: string,
    tokens: StaticToken[]
  ) => {
    const tokenBalances = await getSolanaBalance(
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

  it('should handle empty lists', { retry: retryTimes, timeout }, async () => {
    const walletAddress = defaultWalletAddress
    const tokens: Token[] = []
    await loadAndCompareTokenAmounts(walletAddress, tokens)
  })

  it('should work for stables on SOL', {
    retry: retryTimes,
    timeout,
  }, async () => {
    const walletAddress = defaultWalletAddress
    const tokens = [
      findDefaultToken(CoinKey.SOL, ChainId.SOL),
      findDefaultToken(CoinKey.USDC, ChainId.SOL),
    ]

    await loadAndCompareTokenAmounts(walletAddress, tokens)
  })

  // Graceful degradation for unheld / "invalid" mints (known-zero vs unknown)
  // is covered deterministically in getSolanaBalance.unit.spec.ts — that path
  // makes no per-token RPC call, so it needs no live endpoint.
})
