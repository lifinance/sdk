import { ChainId, CoinKey } from '@lifi/types'
import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment } from '../../tests/setup'
import { findDefaultToken } from '../../tests/tokens'
import ApiService from '../services/ApiService'
import {
  getAllowance,
  getAllowanceMulticall,
  getTokenAllowanceMulticall,
} from './getAllowance'
import type { TokenSpender } from './types'

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

beforeAll(setupTestEnvironment)

describe('allowance integration tests', () => {
  it(
    'should work for ERC20 on POL',
    async () => {
      const allowance = await getAllowance(
        memeToken.chainId,
        memeToken.address,
        defaultWalletAddress,
        defaultSpenderAddress
      )

      expect(allowance).toBeGreaterThanOrEqual(defaultMemeAllowance)
    },
    { retry: retryTimes, timeout }
  )

  it(
    'should work for MATIC on POL',
    async () => {
      const token = findDefaultToken(CoinKey.MATIC, ChainId.POL)

      const allowance = await getAllowance(
        token.chainId,
        token.address,
        defaultWalletAddress,
        defaultSpenderAddress
      )

      expect(allowance).toBe(0n)
    },
    { retry: retryTimes, timeout }
  )

  it(
    'should return even with invalid data on POL',
    async () => {
      const invalidToken = findDefaultToken(CoinKey.MATIC, ChainId.POL)
      invalidToken.address = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'

      const allowance = await getAllowance(
        invalidToken.chainId,
        invalidToken.address,
        defaultWalletAddress,
        defaultSpenderAddress
      )
      expect(allowance).toBe(0n)
    },
    { retry: retryTimes, timeout }
  )

  it(
    'should handle empty lists with multicall',
    async () => {
      const allowances = await getAllowanceMulticall(
        137,
        [],
        defaultWalletAddress
      )
      expect(allowances.length).toBe(0)
    },
    { retry: retryTimes, timeout }
  )

  it(
    'should handle token lists with more than 100 tokens',
    async () => {
      const { tokens } = await ApiService.getTokens({
        chains: [ChainId.POL],
      })
      const filteredTokens = tokens[ChainId.POL]
      filteredTokens.unshift(memeToken)

      expect(filteredTokens?.length).toBeGreaterThan(100)
      const tokenSpenders: TokenSpender[] | undefined = filteredTokens?.map(
        (token) => ({
          token,
          spenderAddress: defaultSpenderAddress,
        })
      )

      if (tokenSpenders?.length) {
        const tokens = await getTokenAllowanceMulticall(
          defaultWalletAddress,
          tokenSpenders.slice(0, 150)
        )

        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i]
          expect(token.allowance).toBeDefined()
        }

        const token = tokens.find((token) => token.allowance)

        expect(token?.allowance).toBeGreaterThanOrEqual(defaultMemeAllowance)
      }
    },
    { retry: retryTimes, timeout }
  )
})
