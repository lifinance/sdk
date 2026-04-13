import type { SDKClient } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callTronRpcsWithRetry, tronWebCache } from './callTronRpcsWithRetry.js'

// Minimal SDKClient stub — only getRpcUrlsByChainId is used by the function.
const makeClient = (urls: string[]): SDKClient =>
  ({
    getRpcUrlsByChainId: vi.fn(async () => urls),
  }) as unknown as SDKClient

describe('callTronRpcsWithRetry', () => {
  beforeEach(() => {
    tronWebCache.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when no URLs are available', async () => {
    await expect(
      callTronRpcsWithRetry(makeClient([]), async () => 'x')
    ).rejects.toThrow('No Tron RPC URLs available')
  })

  it('returns the result from the first URL on success', async () => {
    const client = makeClient(['https://rpc-a.example', 'https://rpc-b.example'])
    const fn = vi.fn(async () => 'ok')

    const result = await callTronRpcsWithRetry(client, fn)

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('falls through to the next URL when the first fails', async () => {
    const client = makeClient(['https://rpc-a.example', 'https://rpc-b.example'])
    const fn = vi
      .fn<(tw: unknown) => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom-a'))
      .mockResolvedValueOnce('ok-b')

    const result = await callTronRpcsWithRetry(client, fn)

    expect(result).toBe('ok-b')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws AggregateError when every URL fails', async () => {
    const client = makeClient(['https://rpc-a.example', 'https://rpc-b.example'])
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom-a'))
      .mockRejectedValueOnce(new Error('boom-b'))

    await expect(callTronRpcsWithRetry(client, fn)).rejects.toMatchObject({
      name: 'AggregateError',
      message: expect.stringContaining('All 2 Tron RPCs failed'),
      errors: [
        expect.objectContaining({ message: 'boom-a' }),
        expect.objectContaining({ message: 'boom-b' }),
      ],
    })
  })

  it('reuses the cached TronWeb instance for repeat calls to the same URL', async () => {
    const client = makeClient(['https://rpc-a.example'])
    const seen: unknown[] = []
    const fn = vi.fn(async (tw: unknown) => {
      seen.push(tw)
      return 'ok'
    })

    await callTronRpcsWithRetry(client, fn)
    await callTronRpcsWithRetry(client, fn)

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
    expect(tronWebCache.size).toBe(1)
  })
})
