import type { SDKClient, Token } from '@lifi/sdk'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('viem/actions', () => ({
  getBalance: vi.fn(),
  getBlockNumber: vi.fn(async () => 100n),
  multicall: vi.fn(),
  readContract: vi.fn(),
}))

vi.mock('../client/publicClient.js', () => ({
  getPublicClient: vi.fn(async () => ({}) as any),
}))

vi.mock('./getMulticallAddress.js', () => ({
  getMulticallAddress: vi.fn(async () => '0xMulti'),
}))

import { multicall } from 'viem/actions'
import { getEthereumBalance } from './getEthereumBalance.js'

const client = {} as SDKClient
const wallet = '0xWallet' as Address

const usdc: Token = {
  chainId: 1,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  priceUSD: '0',
}
const dai: Token = {
  chainId: 1,
  address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  symbol: 'DAI',
  decimals: 18,
  name: 'Dai',
  priceUSD: '0',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getEthereumBalance — multicall partial failure', () => {
  it('returns amount: undefined for sub-call failures and the value for successes', async () => {
    vi.mocked(multicall).mockResolvedValueOnce([
      { status: 'success', result: 5_000_000n },
      { status: 'failure', error: new Error('reverted') },
    ] as any)

    const result = await getEthereumBalance(client, wallet, [usdc, dai])

    expect(result[0].amount).toBe(5_000_000n)
    expect(result[1].amount).toBeUndefined()
    expect(result[0].blockNumber).toBe(100n)
    expect(result[1].blockNumber).toBe(100n)
  })

  it('reports a successful zero balance as 0n (known zero, not unknown)', async () => {
    vi.mocked(multicall).mockResolvedValueOnce([
      { status: 'success', result: 0n },
      { status: 'success', result: 0n },
    ] as any)

    const result = await getEthereumBalance(client, wallet, [usdc, dai])
    expect(result[0].amount).toBe(0n)
    expect(result[1].amount).toBe(0n)
  })
})
