import type { SDKClient } from '@lifi/sdk'
import { type Address, type Client, createClient, custom } from 'viem'
import { base, mainnet } from 'viem/chains'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../client/publicClient.js', () => ({
  getPublicClient: vi.fn(),
}))

import { getPublicClient } from '../client/publicClient.js'
import { getActionWithFallback } from './getActionWithFallback.js'

const FROM_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address

// The wallet RPC fails, so every read goes to the public client fallback.
const walletClient = createClient({
  account: FROM_ADDRESS,
  chain: mainnet,
  transport: custom({
    request: async () => {
      throw new Error('Wallet RPC failed.')
    },
  }),
})

const readChainId = (client: Client, _: undefined) =>
  Promise.resolve((client as { chain?: { id: number } }).chain?.id)

beforeEach(() => {
  vi.mocked(getPublicClient).mockImplementation(async (_, chainId) =>
    createClient({
      chain: { ...base, id: chainId },
      transport: custom({ request: async () => null }),
    })
  )
})

describe('getActionWithFallback', () => {
  it('falls back to a public client for the given chain', async () => {
    const failingRead = async (client: Client, params: undefined) => {
      if (client === walletClient) {
        throw new Error('Wallet RPC failed.')
      }
      return readChainId(client, params)
    }

    const chainId = await getActionWithFallback(
      {} as SDKClient,
      walletClient,
      failingRead,
      'failingRead',
      undefined,
      base.id
    )

    expect(getPublicClient).toHaveBeenCalledWith({}, base.id)
    expect(chainId).toBe(base.id)
  })

  it('falls back to a public client for the wallet client chain', async () => {
    const failingRead = async (client: Client, params: undefined) => {
      if (client === walletClient) {
        throw new Error('Wallet RPC failed.')
      }
      return readChainId(client, params)
    }

    await getActionWithFallback(
      {} as SDKClient,
      walletClient,
      failingRead,
      'failingRead',
      undefined
    )

    expect(getPublicClient).toHaveBeenCalledWith({}, mainnet.id)
  })
})
