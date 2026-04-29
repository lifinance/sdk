import type { SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('viem/actions', () => ({
  getCode: vi.fn(),
}))

vi.mock('../client/publicClient.js', () => ({
  getPublicClient: vi.fn(),
}))

import { getCode } from 'viem/actions'
import { getPublicClient } from '../client/publicClient.js'
import { getAccountCode } from './getAccountCode.js'

const client = {} as SDKClient
const ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const ADDRESS_2 = '0xbbbb000000000000000000000000000000000002' as Address
const SOURCE_CHAIN = 137
const WALLET_CHAIN = 1

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getAccountCode — chain correctness', () => {
  it('queries the public client for the chainId argument, NOT a wallet-derived chain id', async () => {
    // Pins the chainId arg identity — guards against a future "use wallet
    // client for perf" refactor silently re-introducing the cross-chain bug.
    const publicClient = { chain: { id: SOURCE_CHAIN } } as any
    vi.mocked(getPublicClient).mockResolvedValue(publicClient)
    vi.mocked(getCode).mockResolvedValue('0x6080' as `0x${string}`)

    await getAccountCode({ client, chainId: SOURCE_CHAIN, address: ADDRESS })

    expect(getPublicClient).toHaveBeenCalledTimes(1)
    expect(getPublicClient).toHaveBeenCalledWith(client, SOURCE_CHAIN)
    expect(SOURCE_CHAIN).not.toBe(WALLET_CHAIN)
  })
})

describe('getAccountCode — no cross-execution cache', () => {
  it('re-fetches on sequential calls so a re-delegation in another tab is never served stale', async () => {
    // Locks the no-cache decision — a future "add cache for perf" change
    // would silently re-introduce the staleness bug this PR set out to fix.
    vi.mocked(getPublicClient).mockResolvedValue({} as any)
    vi.mocked(getCode).mockResolvedValue('0x6080' as `0x${string}`)

    await getAccountCode({ client, chainId: SOURCE_CHAIN, address: ADDRESS })
    await getAccountCode({ client, chainId: SOURCE_CHAIN, address: ADDRESS })

    expect(getCode).toHaveBeenCalledTimes(2)
  })
})

describe('getAccountCode — concurrent dedupe', () => {
  it('collapses concurrent in-flight calls for the same (chain, address) into a single RPC', async () => {
    let resolveCode!: (value: `0x${string}`) => void
    const codePromise = new Promise<`0x${string}`>((resolve) => {
      resolveCode = resolve
    })
    vi.mocked(getPublicClient).mockResolvedValue({} as any)
    vi.mocked(getCode).mockReturnValue(codePromise)

    const a = getAccountCode({
      client,
      chainId: SOURCE_CHAIN,
      address: ADDRESS,
    })
    const b = getAccountCode({
      client,
      chainId: SOURCE_CHAIN,
      address: ADDRESS,
    })

    resolveCode('0x6080' as `0x${string}`)
    const [resA, resB] = await Promise.all([a, b])

    expect(resA).toBe('0x6080')
    expect(resB).toBe('0x6080')
    expect(getCode).toHaveBeenCalledTimes(1)
  })

  it('does not collapse calls for different addresses on the same chain', async () => {
    vi.mocked(getPublicClient).mockResolvedValue({} as any)
    vi.mocked(getCode).mockResolvedValue('0x6080' as `0x${string}`)

    await Promise.all([
      getAccountCode({ client, chainId: SOURCE_CHAIN, address: ADDRESS }),
      getAccountCode({ client, chainId: SOURCE_CHAIN, address: ADDRESS_2 }),
    ])

    expect(getCode).toHaveBeenCalledTimes(2)
  })
})

describe('getAccountCode — failure handling', () => {
  it('returns undefined when getPublicClient throws', async () => {
    vi.mocked(getPublicClient).mockRejectedValue(new Error('chain unknown'))

    await expect(
      getAccountCode({ client, chainId: SOURCE_CHAIN, address: ADDRESS })
    ).resolves.toBeUndefined()
  })

  it('returns undefined when getCode throws', async () => {
    vi.mocked(getPublicClient).mockResolvedValue({} as any)
    vi.mocked(getCode).mockRejectedValue(new Error('rpc down'))

    await expect(
      getAccountCode({ client, chainId: SOURCE_CHAIN, address: ADDRESS })
    ).resolves.toBeUndefined()
  })
})
