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

// A live mainnet account, used only as a read target. The account needs a
// trustline for every non-native asset the tests read, because a SAC balance
// call on a missing trustline fails the simulation and degrades to an absent
// amount rather than returning zero. This one holds XLM. Give it a USDC
// trustline, or swap the address, before un-skipping the USDC case.
const defaultWalletAddress =
  'GB3TRHIIJIP3L54672MTHWTS6M5I3STHOZ372PZAKC63H6VJ3C222HPP'

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
