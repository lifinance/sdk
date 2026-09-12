import { ChainType, type SDKClient } from '@lifi/sdk'
import { createClient, fallback, http } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')

  return {
    ...actual,
    createClient: vi.fn((options) => ({ options })),
    fallback: vi.fn((transports) => ({ transports })),
    http: vi.fn((url) => ({ url })),
  }
})

const chain = {
  id: 1,
  metamask: {
    chainName: 'Ethereum',
    rpcUrls: ['https://chain-config.example'],
  },
}

const createSdkClient = (rpcUrl: string) =>
  ({
    getRpcUrlsByChainId: vi.fn().mockResolvedValue([rpcUrl]),
    getChainById: vi.fn().mockResolvedValue(chain),
    getProvider: vi.fn().mockReturnValue(undefined),
  }) as unknown as SDKClient

describe('getPublicClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('does not reuse a transport configured by another SDK client', async () => {
    const { getPublicClient } = await import('./publicClient.js')
    const firstSdkClient = createSdkClient('https://first-rpc.example')
    const secondSdkClient = createSdkClient('https://second-rpc.example')

    const firstPublicClient = await getPublicClient(firstSdkClient, chain.id)
    const secondPublicClient = await getPublicClient(secondSdkClient, chain.id)

    expect(firstPublicClient).not.toBe(secondPublicClient)
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(http).toHaveBeenNthCalledWith(1, 'https://first-rpc.example', {
      batch: { batchSize: 64 },
    })
    expect(http).toHaveBeenNthCalledWith(2, 'https://second-rpc.example', {
      batch: { batchSize: 64 },
    })
    expect(fallback).toHaveBeenCalledTimes(2)
    expect(firstSdkClient.getProvider).toHaveBeenCalledWith(ChainType.EVM)
    expect(secondSdkClient.getProvider).toHaveBeenCalledWith(ChainType.EVM)
  })

  it('reuses the public client for repeated requests from the same SDK client', async () => {
    const { getPublicClient } = await import('./publicClient.js')
    const sdkClient = createSdkClient('https://rpc.example')

    const firstPublicClient = await getPublicClient(sdkClient, chain.id)
    const secondPublicClient = await getPublicClient(sdkClient, chain.id)

    expect(firstPublicClient).toBe(secondPublicClient)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(http).toHaveBeenCalledTimes(1)
  })
})
