import type { SDKClient } from '@lifi/sdk'
import { type Address, type Client, createClient, custom } from 'viem'
import { base, mainnet } from 'viem/chains'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../client/publicClient.js', () => ({
  getPublicClient: vi.fn(),
}))

import { getPublicClient } from '../client/publicClient.js'
import { getActionWithFallback } from './getActionWithFallback.js'

// Its `chain` is stale and its RPC fails, so every read falls back.
const walletClient = createClient({
  account: '0xaaaa000000000000000000000000000000000001' as Address,
  chain: mainnet,
  transport: custom({
    request: async () => {
      throw new Error('Wallet RPC failed.')
    },
  }),
})

const readOffWallet = async (client: Client) => {
  if (client === walletClient) {
    throw new Error('Wallet RPC failed.')
  }
  return client.chain?.id
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPublicClient).mockImplementation(async (_, chainId) =>
    createClient({
      chain: { ...base, id: chainId },
      transport: custom({ request: async () => null }),
    })
  )
})

describe('getActionWithFallback', () => {
  it('falls back to a public client on the given chain', async () => {
    const chainId = await getActionWithFallback(
      {} as SDKClient,
      walletClient,
      readOffWallet,
      'readOffWallet',
      undefined,
      base.id
    )

    expect(getPublicClient).toHaveBeenCalledWith({}, base.id)
    expect(chainId).toBe(base.id)
  })

  it('rethrows the wallet error when no chain is given', async () => {
    await expect(
      getActionWithFallback(
        {} as SDKClient,
        walletClient,
        readOffWallet,
        'readOffWallet',
        undefined,
        undefined
      )
    ).rejects.toThrow('Wallet RPC failed.')
    expect(getPublicClient).not.toHaveBeenCalled()
  })
})
