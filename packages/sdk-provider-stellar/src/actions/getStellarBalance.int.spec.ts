import { findDefaultToken } from '@lifi/data-types'
import {
  ChainId,
  CoinKey,
  createClient,
  type StaticToken,
  type Token,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { getStellarBalance } from './getStellarBalance.js'

const client = createClient({
  integrator: 'lifi-sdk',
})

// A well-known, long-lived mainnet account (the SDF public distribution
// account). Only used as a read target — the assertions below hold for any
// valid G-address, funded or not, so this test does not depend on a balance.
const defaultWalletAddress =
  'GCKFBEIYV2U22IO2AM6SVKMSAWTM3KOMSGYPWDLNCONJZLQGH2FQNBRW'

const retryTimes = 2
const timeout = 20000

// Skipped until the LI.FI API serves Stellar chains. `GET /v1/chains?chainTypes=STL`
// currently returns an empty array, so `client.getRpcUrlsByChainId(ChainId.XLM)`
// throws and every balance read degrades to an absent amount. Remove `.skip` once
// STL chains are live — no other change should be needed.
describe.skip
  .sequential('Stellar token balance', async () => {
    const loadAndCompareTokenAmounts = async (
      walletAddress: string,
      tokens: StaticToken[]
    ) => {
      const tokenBalances = await getStellarBalance(
        client,
        walletAddress,
        tokens as Token[]
      )

      expect(tokenBalances.length).toEqual(tokens.length)

      for (let i = 0; i < tokens.length; i++) {
        expect(tokens[i].address).toEqual(tokenBalances[i].address)
        expect(tokenBalances[i].amount).toBeDefined()
        expect(tokenBalances[i].amount).toBeGreaterThanOrEqual(0n)
      }
    }

    it('should handle empty lists', {
      retry: retryTimes,
      timeout,
    }, async () => {
      await loadAndCompareTokenAmounts(defaultWalletAddress, [])
    })

    it('should work for native XLM and USDC', {
      retry: retryTimes,
      timeout,
    }, async () => {
      await loadAndCompareTokenAmounts(defaultWalletAddress, [
        findDefaultToken(CoinKey.XLM, ChainId.XLM),
        findDefaultToken(CoinKey.USDC, ChainId.XLM),
      ])
    })

    it('should return the token without an amount for an unreadable contract', {
      retry: retryTimes,
      timeout,
    }, async () => {
      const invalidToken = findDefaultToken(CoinKey.USDC, ChainId.XLM)
      // A syntactically valid C-address that hosts no SAC — its balance()
      // simulation fails, which must degrade to an absent amount rather than
      // rejecting the whole batch.
      invalidToken.address =
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAV'

      const tokenBalances = await getStellarBalance(
        client,
        defaultWalletAddress,
        [findDefaultToken(CoinKey.XLM, ChainId.XLM), invalidToken] as Token[]
      )

      expect(tokenBalances.length).toBe(2)
      const invalidBalance = tokenBalances.find(
        (token) => token.address === invalidToken.address
      )
      expect(invalidBalance).toBeDefined()
      expect(invalidBalance!.amount).toBeUndefined()
    })
  })
