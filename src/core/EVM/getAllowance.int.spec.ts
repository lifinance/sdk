import { findDefaultToken } from '@lifi/data-types'
import { ChainId, CoinKey } from '@lifi/types'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { getTokens } from '../../actions/getTokens.js'
import { createClient } from '../client/createClient.js'
import { EVM } from './EVM.js'
import {
  getAllowance,
  getAllowanceMulticall,
  getTokenAllowanceMulticall,
} from './getAllowance.js'
import { getPublicClient } from './publicClient.js'
import type { TokenSpender } from './types.js'

const client = createClient({
  integrator: 'lifi-sdk',
})
client.setProviders([EVM()])

const defaultWalletAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
const defaultSpenderAddress = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
const memeToken = {
  name: 'Memecoin',
  symbol: 'MEM',
  decimals: 18,
  address: '0x42dbbd5ae373fea2fc320f62d44c058522bb3758',
  chainId: 137,
  priceUSD: '',
}
const defaultMemeAllowance = 123000000000000000000n

const retryTimes = 2
const timeout = 10000

describe('allowance integration tests', { retry: retryTimes, timeout }, () => {
  it('should work for ERC20 on POL', async () => {
    const viemClient = await getPublicClient(client, memeToken.chainId)
    const allowance = await getAllowance(
      client,
      viemClient,
      memeToken.address as Address,
      defaultWalletAddress,
      defaultSpenderAddress
    )

    expect(allowance).toBeGreaterThanOrEqual(defaultMemeAllowance)
  })

  it(
    'should work for MATIC on POL',
    { retry: retryTimes, timeout },
    async () => {
      const token = findDefaultToken(CoinKey.POL, ChainId.POL)
      const viemClient = await getPublicClient(client, token.chainId)
      const allowance = await getAllowance(
        client,
        viemClient,
        token.address as Address,
        defaultWalletAddress,
        defaultSpenderAddress
      )

      expect(allowance).toBe(0n)
    }
  )

  it(
    'should return even with invalid data on POL',
    { retry: retryTimes, timeout },
    async () => {
      const invalidToken = findDefaultToken(CoinKey.POL, ChainId.POL)
      invalidToken.address = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'
      const viemClient = await getPublicClient(client, invalidToken.chainId)
      const allowance = await getAllowance(
        client,
        viemClient,
        invalidToken.address as Address,
        defaultWalletAddress,
        defaultSpenderAddress
      )
      expect(allowance).toBe(0n)
    }
  )

  it(
    'should handle empty lists with multicall',
    { retry: retryTimes, timeout },
    async () => {
      const viemClient = await getPublicClient(client, 137)
      const allowances = await getAllowanceMulticall(
        client,
        viemClient,
        137,
        [],
        defaultWalletAddress
      )
      expect(allowances.length).toBe(0)
    }
  )

  it(
    'should handle token lists with more than 10 tokens',
    { retry: retryTimes, timeout },
    async () => {
      const { tokens } = await getTokens(client.config, {
        chains: [ChainId.POL],
      })
      const filteredTokens = tokens[ChainId.POL]
      filteredTokens.unshift(memeToken)

      expect(filteredTokens?.length).toBeGreaterThanOrEqual(10)
      const tokenSpenders: TokenSpender[] | undefined = filteredTokens?.map(
        (token) => ({
          token,
          spenderAddress: defaultSpenderAddress,
        })
      )

      if (tokenSpenders?.length) {
        const tokens = await getTokenAllowanceMulticall(
          client,
          defaultWalletAddress,
          tokenSpenders.slice(0, 10)
        )

        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i]
          expect(token.allowance).toBeDefined()
        }

        const token = tokens.find((token) => token.allowance)

        expect(token?.allowance).toBeGreaterThanOrEqual(defaultMemeAllowance)
      }
    }
  )
})
