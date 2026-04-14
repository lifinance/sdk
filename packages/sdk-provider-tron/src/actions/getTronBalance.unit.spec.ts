import type { SDKClient, Token } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tronWebCache } from '../rpc/callTronRpcsWithRetry.js'
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
})
