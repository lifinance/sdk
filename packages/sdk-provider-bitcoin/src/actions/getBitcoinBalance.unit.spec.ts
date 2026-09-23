import { ChainId, createClient, type Token } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBitcoinBalance } from './getBitcoinBalance.js'

const mocks = vi.hoisted(() => ({ getBitcoinPublicClient: vi.fn() }))

vi.mock('../client/publicClient.js', () => ({
  getBitcoinPublicClient: mocks.getBitcoinPublicClient,
}))

const client = createClient({ integrator: 'lifi-sdk' })
const walletAddress = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'

const nativeToken = (chainId: ChainId, symbol: string): Token =>
  ({
    chainId,
    address: symbol.toLowerCase(),
    symbol,
    name: symbol,
    decimals: 8,
    priceUSD: '0',
  }) as Token

describe('getBitcoinBalance', () => {
  beforeEach(() => {
    mocks.getBitcoinPublicClient.mockReset()
    mocks.getBitcoinPublicClient.mockResolvedValue({
      getBalance: vi.fn().mockResolvedValue(1234n),
      getBlockCount: vi.fn().mockResolvedValue(900_000),
    })
  })

  it('reads the Bitcoin balance for BTC', async () => {
    const [balance] = await getBitcoinBalance(client, walletAddress, [
      nativeToken(ChainId.BTC, 'BTC'),
    ])

    expect(balance.amount).toBe(1234n)
    expect(balance.blockNumber).toBe(900_000n)
  })

  it('leaves the amount unknown for ZEC and asks no Bitcoin node', async () => {
    const [balance] = await getBitcoinBalance(client, walletAddress, [
      nativeToken(ChainId.ZEC, 'ZEC'),
    ])

    expect(balance.amount).toBeUndefined()
    expect(balance.symbol).toBe('ZEC')
    expect(mocks.getBitcoinPublicClient).not.toHaveBeenCalled()
  })
})
