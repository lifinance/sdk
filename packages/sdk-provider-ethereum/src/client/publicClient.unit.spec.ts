import type { SDKClient } from '@lifi/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicClient } from './publicClient.js'

// The module caches one client per chain id for the whole process, so each
// test uses its own chain id.

const RPC_URL = 'https://rpc.invalid'

const chainFor = (id: number) => ({
  id,
  metamask: {
    chainId: `0x${id.toString(16)}`,
    chainName: `Chain ${id}`,
    rpcUrls: [RPC_URL],
    blockExplorerUrls: [],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
})

const makeClient = (providerOptions: object = {}) => {
  const client = {
    getRpcUrlsByChainId: vi.fn(async () => [RPC_URL]),
    getChainById: vi.fn(async (id: number) => chainFor(id)),
    getProvider: () => ({ options: providerOptions }),
  }
  return { client, sdkClient: client as unknown as SDKClient }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('getPublicClient', () => {
  it('builds one client for concurrent first calls for a chain', async () => {
    const { client, sdkClient } = makeClient()

    const publicClients = await Promise.all(
      Array.from({ length: 5 }, () => getPublicClient(sdkClient, 10))
    )

    expect(new Set(publicClients).size).toBe(1)
    expect(client.getChainById).toHaveBeenCalledTimes(1)
    expect(await getPublicClient(sdkClient, 10)).toBe(publicClients[0])
  })

  // With `rank`, viem's fallback transport pings its transports in a loop
  // that never ends. A second client for the chain would run a second loop.
  it('starts one ranking loop for concurrent first calls when transports are ranked', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'))
        const reply = (request: { id: number }) => ({
          jsonrpc: '2.0',
          id: request.id,
          result: '0x1',
        })
        return new Response(
          JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body)),
          { headers: { 'Content-Type': 'application/json' } }
        )
      })
    )
    const { sdkClient } = makeClient({
      fallbackTransportConfig: { rank: { interval: 4_000 } },
    })

    await Promise.all(
      Array.from({ length: 5 }, () => getPublicClient(sdkClient, 8453))
    )
    await vi.advanceTimersByTimeAsync(40_000)

    expect(vi.getTimerCount()).toBe(1)
  })

  it('builds the client again after the first build fails', async () => {
    const { client, sdkClient } = makeClient()
    client.getRpcUrlsByChainId.mockRejectedValueOnce(
      new Error('RPC URL not found for chainId: 42161')
    )

    await expect(getPublicClient(sdkClient, 42161)).rejects.toThrow(
      'RPC URL not found for chainId: 42161'
    )
    const publicClient = await getPublicClient(sdkClient, 42161)

    expect(publicClient.chain?.id).toBe(42161)
    expect(client.getRpcUrlsByChainId).toHaveBeenCalledTimes(2)
  })
})
