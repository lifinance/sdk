import type { SDKClient } from '@lifi/sdk'
import type { Address, Client } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../actions/getAccountCode.js', () => ({
  getAccountCode: vi.fn(),
}))

import { getAccountCode } from '../actions/getAccountCode.js'
import { canAccountUseNativePermits } from './canAccountUseNativePermits.js'

const sdkClient = {} as SDKClient
const ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address

const buildViemClient = (overrides?: {
  chainId?: number | undefined
}): Client =>
  ({
    chain:
      overrides?.chainId === undefined ? undefined : { id: overrides.chainId },
    account: { address: ADDRESS },
  }) as unknown as Client

beforeEach(() => {
  vi.clearAllMocks()
})

describe('canAccountUseNativePermits — truth table', () => {
  it('returns true for a plain EOA (empty code)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x')
    expect(
      await canAccountUseNativePermits(
        sdkClient,
        buildViemClient({ chainId: 1 })
      )
    ).toBe(true)
  })

  it('returns true for an EIP-7702 delegated EOA', async () => {
    vi.mocked(getAccountCode).mockResolvedValue(
      '0xef0100a94f5374fce5edbc8e2a8697c15331677e6ebf0b' as `0x${string}`
    )
    expect(
      await canAccountUseNativePermits(
        sdkClient,
        buildViemClient({ chainId: 1 })
      )
    ).toBe(true)
  })

  it('returns false for a smart-contract wallet (Safe / 4337 / 7579 / custom bytecode)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    expect(
      await canAccountUseNativePermits(
        sdkClient,
        buildViemClient({ chainId: 1 })
      )
    ).toBe(false)
  })
})

describe('canAccountUseNativePermits — load-bearing failure guards', () => {
  it('returns false when chainId is undefined and skips the RPC entirely', async () => {
    expect(await canAccountUseNativePermits(sdkClient, buildViemClient())).toBe(
      false
    )
    expect(getAccountCode).not.toHaveBeenCalled()
  })

  it('returns false on RPC failure (code === undefined)', async () => {
    // Locks "no permits if unsure" — without this guard,
    // `!isSmartContractWalletCode(undefined) === true` would silently flip
    // RPC failure into "use permits" and let a flaky RPC produce broken ones.
    vi.mocked(getAccountCode).mockResolvedValue(undefined)
    expect(
      await canAccountUseNativePermits(
        sdkClient,
        buildViemClient({ chainId: 1 })
      )
    ).toBe(false)
  })
})
