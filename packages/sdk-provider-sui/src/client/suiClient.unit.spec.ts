import type { SDKClient } from '@lifi/sdk'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Records the base URL of every Sui client the module builds.
const { built } = vi.hoisted(() => ({ built: [] as string[] }))
vi.mock('@mysten/sui/grpc', () => ({
  SuiGrpcClient: class {
    readonly baseUrl: string
    constructor(options: { baseUrl: string }) {
      this.baseUrl = options.baseUrl
      built.push(options.baseUrl)
    }
  },
}))

import { callSuiWithRetry } from './suiClient.js'

// The module caches clients for the whole process, so each test uses its own
// URLs.
const sdkClient = (rpcUrls: string[]) =>
  ({ getRpcUrlsByChainId: async () => rpcUrls }) as unknown as SDKClient

const baseUrlOf = (suiClient: SuiGrpcClient) =>
  (suiClient as unknown as { baseUrl: string }).baseUrl

const unavailable = async (): Promise<never> => {
  throw new Error('unavailable')
}

beforeEach(() => {
  built.length = 0
})

describe('callSuiWithRetry', () => {
  it('tries each RPC URL of the call once, however many URLs earlier calls used', async () => {
    const triesPerCall: number[] = []
    for (let i = 0; i < 200; i++) {
      let tries = 0
      await expect(
        callSuiWithRetry(sdkClient([`https://sui-${i}.test/key-${i}`]), () => {
          tries++
          return unavailable()
        })
      ).rejects.toThrow('unavailable')
      triesPerCall.push(tries)
    }

    expect(Math.max(...triesPerCall)).toBe(1)

    let tries = 0
    await expect(
      callSuiWithRetry(
        sdkClient(['https://sui-a.test', 'https://sui-b.test']),
        () => {
          tries++
          return unavailable()
        }
      )
    ).rejects.toThrow('unavailable')
    expect(tries).toBe(2)
  })

  // With one SDK client per tenant, each with its own RPC URL and API key, a
  // call must never reach the URL of another tenant.
  it('uses only the RPC URLs of the call, in their configured order', async () => {
    const tenantA = 'https://sui.test/tenant-a-key'
    const tenantB = 'https://sui.test/tenant-b-key'
    const tenantBBackup = 'https://sui-backup.test/tenant-b-key'
    await callSuiWithRetry(sdkClient([tenantA]), async () => 'ok')
    await callSuiWithRetry(sdkClient([tenantBBackup]), async () => 'ok')

    const reached: string[] = []
    await expect(
      callSuiWithRetry(sdkClient([tenantB, tenantBBackup]), (suiClient) => {
        reached.push(baseUrlOf(suiClient))
        return unavailable()
      })
    ).rejects.toThrow('unavailable')

    expect(reached).toEqual([tenantB, tenantBBackup])
  })

  it('throws a clear error when the SDK client has no Sui RPC URLs', async () => {
    const fn = vi.fn(async () => 'ok')

    // Not `rejects.toThrow(message)`: in Vitest 5 it also passes for a
    // promise that rejects with `null`.
    const error = await callSuiWithRetry(sdkClient([]), fn).catch(
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('No Sui RPC URLs available')
    expect(fn).not.toHaveBeenCalled()
  })

  it('reuses the client of a URL used within the last 64 URLs', async () => {
    const url = 'https://sui-reused.test'
    await callSuiWithRetry(sdkClient([url]), async () => 'ok')
    for (let i = 0; i < 63; i++) {
      await callSuiWithRetry(
        sdkClient([`https://sui-reused-${i}.test`]),
        async () => 'ok'
      )
    }

    await callSuiWithRetry(sdkClient([url]), async () => 'ok')

    expect(built.filter((baseUrl) => baseUrl === url)).toHaveLength(1)
  })

  it('keeps at most 64 clients: a URL not used within the last 64 URLs gets a new client', async () => {
    const url = 'https://sui-evicted.test'
    await callSuiWithRetry(sdkClient([url]), async () => 'ok')
    for (let i = 0; i < 64; i++) {
      await callSuiWithRetry(
        sdkClient([`https://sui-evicted-${i}.test`]),
        async () => 'ok'
      )
    }

    await callSuiWithRetry(sdkClient([url]), async () => 'ok')

    expect(built.filter((baseUrl) => baseUrl === url)).toHaveLength(2)
  })
})
