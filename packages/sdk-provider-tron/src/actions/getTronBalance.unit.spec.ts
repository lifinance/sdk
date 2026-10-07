import { ChainId, type SDKClient, type Token } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tronWebCache } from '../rpc/callTronRpcsWithRetry.js'
import {
  addressArgument,
  fakeTronNode,
  hexAddress,
  tronAddress,
} from '../rpc/tronNode.unit.mock.js'
import { getTronBalance } from './getTronBalance.js'

const makeClient = (): SDKClient =>
  ({
    getRpcUrlsByChainId: vi.fn(async () => []),
    getChains: vi.fn(async () => []),
  }) as unknown as SDKClient

describe('getTronBalance', () => {
  beforeEach(() => {
    tronWebCache.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns an empty array when no tokens are provided', async () => {
    const result = await getTronBalance(
      makeClient(),
      'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
      []
    )
    expect(result).toEqual([])
  })

  it('warns when tokens span multiple chainIds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tokens = [
      {
        chainId: 728126428,
        address: '0x0',
        decimals: 6,
        symbol: 'a',
        name: 'a',
        priceUSD: '0',
        coinKey: 'a',
      },
      {
        chainId: 1,
        address: '0x0',
        decimals: 6,
        symbol: 'b',
        name: 'b',
        priceUSD: '0',
        coinKey: 'b',
      },
    ] as unknown as Token[]

    // The call will fail at getRpcUrlsByChainId (empty) — we only care that the
    // warning fires before that, matching the convention across other providers.
    await getTronBalance(
      makeClient(),
      'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
      tokens
    ).catch(() => {})

    expect(warn).toHaveBeenCalledWith(
      'Requested tokens have to be on the same chain.'
    )
  })

  // `tronWeb.contract().at(token)` sends `wallet/getcontract` on every call
  // and keeps each token's ABI and bytecode in `trx.cache.contracts`, which
  // never shrinks. A static TRC-20 ABI needs neither.
  it('reads a TRC-20 balance without fetching the token contract', async () => {
    const url = 'https://tron-balance.test'
    const node = fakeTronNode(url, 500n)
    const client = {
      getRpcUrlsByChainId: vi.fn(async () => [url]),
      getChains: vi.fn(async () => []),
    } as unknown as SDKClient

    const wallet = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'
    const addresses = [1, 2, 3, 4, 5].map(tronAddress)

    for (const address of addresses) {
      const token: Token = {
        chainId: ChainId.TRN,
        address,
        symbol: 'TKN',
        decimals: 6,
        name: 'Token',
        priceUSD: '0',
      }
      const [balance] = await getTronBalance(client, wallet, [token])
      expect(balance.amount).toBe(500n)
    }

    expect(node.endpoints).not.toContain('wallet/getcontract')
    expect(node.cachedContracts()).toBe(0)
    // Each read calls balanceOf(wallet) on its own token.
    expect(node.constantCalls).toEqual(
      addresses.map((address) => ({
        contractAddress: hexAddress(address),
        functionSelector: 'balanceOf(address)',
        parameter: addressArgument(wallet),
      }))
    )
  })
})
