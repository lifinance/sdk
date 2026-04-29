import type { SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./getAccountCode.js', () => ({
  getAccountCode: vi.fn(),
}))

vi.mock('../client/safeClient.js', () => ({
  getSafeClient: vi.fn(),
}))

import { getSafeClient } from '../client/safeClient.js'
import { getAccountCode } from './getAccountCode.js'
import { isSafeWallet } from './isSafeWallet.js'

const client = {} as SDKClient
const CHAIN_ID = 1
// Fresh address per test — the module-level safeWalletCache persists.
let counter = 0
const freshAddress = (): Address =>
  `0x${(counter++).toString(16).padStart(40, '0')}` as Address

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isSafeWallet — short-circuit via eth_getCode', () => {
  it('returns false without hitting the Safe API for an EOA (empty code)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x')

    expect(
      await isSafeWallet({ client, chainId: CHAIN_ID, address: freshAddress() })
    ).toBe(false)
    expect(getSafeClient).not.toHaveBeenCalled()
  })

  it('returns false without hitting the Safe API for an EIP-7702 delegated EOA', async () => {
    vi.mocked(getAccountCode).mockResolvedValue(
      '0xef0100a94f5374fce5edbc8e2a8697c15331677e6ebf0b' as `0x${string}`
    )

    expect(
      await isSafeWallet({ client, chainId: CHAIN_ID, address: freshAddress() })
    ).toBe(false)
    expect(getSafeClient).not.toHaveBeenCalled()
  })
})

describe('isSafeWallet — RPC-failure fallback', () => {
  it('falls through to the Safe API when getAccountCode returns undefined (RPC unavailable)', async () => {
    // Locks the "independent fallback" semantic: Safe Transaction Service
    // doesn't depend on the chain RPC, so a flaky chain shouldn't blind us
    // to a real Safe.
    vi.mocked(getAccountCode).mockResolvedValue(undefined)
    vi.mocked(getSafeClient).mockReturnValue({
      getInfo: vi.fn(async () => ({}) as any),
    } as any)

    expect(
      await isSafeWallet({ client, chainId: CHAIN_ID, address: freshAddress() })
    ).toBe(true)
    expect(getSafeClient).toHaveBeenCalledTimes(1)
  })

  it('returns false after Safe API rejects, when getAccountCode returned undefined', async () => {
    vi.mocked(getAccountCode).mockResolvedValue(undefined)
    vi.mocked(getSafeClient).mockReturnValue({
      getInfo: vi.fn(async () => {
        throw new Error('not found')
      }),
    } as any)

    expect(
      await isSafeWallet({ client, chainId: CHAIN_ID, address: freshAddress() })
    ).toBe(false)
  })
})

describe('isSafeWallet — defensive guards', () => {
  it('returns false without any RPC when address is missing', async () => {
    expect(
      await isSafeWallet({
        client,
        chainId: CHAIN_ID,
        address: undefined as unknown as Address,
      })
    ).toBe(false)
    expect(getAccountCode).not.toHaveBeenCalled()
    expect(getSafeClient).not.toHaveBeenCalled()
  })
})

describe('isSafeWallet — Safe API verdict', () => {
  it('returns true for a contract address that the Safe API recognizes', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    vi.mocked(getSafeClient).mockReturnValue({
      getInfo: vi.fn(async () => ({}) as any),
    } as any)

    expect(
      await isSafeWallet({ client, chainId: CHAIN_ID, address: freshAddress() })
    ).toBe(true)
  })

  it('returns false for a contract address that the Safe API does not recognize', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    vi.mocked(getSafeClient).mockReturnValue({
      getInfo: vi.fn(async () => {
        throw new Error('not found')
      }),
    } as any)

    expect(
      await isSafeWallet({ client, chainId: CHAIN_ID, address: freshAddress() })
    ).toBe(false)
  })
})

describe('isSafeWallet — caching', () => {
  it('caches the verdict per (chainId, address): a second call does not re-query getAccountCode', async () => {
    const address = freshAddress()
    vi.mocked(getAccountCode).mockResolvedValue('0x')

    const first = await isSafeWallet({ client, chainId: CHAIN_ID, address })
    const second = await isSafeWallet({ client, chainId: CHAIN_ID, address })

    expect(first).toBe(false)
    expect(second).toBe(false)
    expect(getAccountCode).toHaveBeenCalledTimes(1)
  })
})
