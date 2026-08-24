import type { ExtendedChain, SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../permits/canAccountUsePermit2.js', () => ({
  canAccountUsePermit2: vi.fn(),
}))
vi.mock('./getAllowance.js', () => ({ getAllowance: vi.fn() }))
vi.mock('../utils/getActionWithFallback.js', () => ({
  getActionWithFallback: vi.fn(),
}))
vi.mock('../client/publicClient.js', () => ({ getPublicClient: vi.fn() }))

import { getPublicClient } from '../client/publicClient.js'
import { canAccountUsePermit2 } from '../permits/canAccountUsePermit2.js'
import { getActionWithFallback } from '../utils/getActionWithFallback.js'
import { checkPermitSupport } from './checkPermitSupport.js'
import { getAllowance } from './getAllowance.js'

const OWNER = '0xaaaa000000000000000000000000000000000001' as Address
const TOKEN = '0xbbbb000000000000000000000000000000000002' as Address
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address
const CHAIN_ID = 4663
const AMOUNT = 1000n

const client = {
  getProvider: () => undefined,
} as unknown as SDKClient

const chain = {
  id: CHAIN_ID,
  permit2: PERMIT2,
  permit2Proxy: '0x1111111111111111111111111111111111111111',
} as unknown as ExtendedChain

const subject = () =>
  checkPermitSupport(client, {
    chain,
    tokenAddress: TOKEN,
    ownerAddress: OWNER,
    amount: AMOUNT,
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPublicClient).mockResolvedValue({} as never)
  vi.mocked(getActionWithFallback).mockResolvedValue(undefined)
  vi.mocked(getAllowance).mockResolvedValue(AMOUNT * 2n)
  vi.mocked(canAccountUsePermit2).mockResolvedValue(true)
})

describe('checkPermitSupport — Permit2 signer gate', () => {
  it('reports no usable Permit2 allowance for an owner with code, and skips the allowance read', async () => {
    // A 7702-delegated EOA can still hold a large allowance from its plain-EOA
    // days. Reporting it as sufficient would skip an approval that is needed.
    vi.mocked(canAccountUsePermit2).mockResolvedValue(false)

    await expect(subject()).resolves.toEqual({
      nativePermitSupported: false,
      permit2AllowanceSufficient: false,
    })
    expect(getAllowance).not.toHaveBeenCalled()
  })

  it('still reads the allowance for a signer that can use Permit2', async () => {
    await expect(subject()).resolves.toEqual({
      nativePermitSupported: false,
      permit2AllowanceSufficient: true,
    })
    expect(getAllowance).toHaveBeenCalledWith(
      client,
      expect.anything(),
      TOKEN,
      OWNER,
      PERMIT2
    )
  })

  it('reports an insufficient allowance as insufficient', async () => {
    vi.mocked(getAllowance).mockResolvedValue(AMOUNT - 1n)
    await expect(subject()).resolves.toMatchObject({
      permit2AllowanceSufficient: false,
    })
  })

  it('checks the signer on the chain being queried', async () => {
    await subject()
    expect(canAccountUsePermit2).toHaveBeenCalledWith(client, {
      chainId: CHAIN_ID,
      address: OWNER,
    })
  })

  it('does not consult the signer gate when the chain has no Permit2', async () => {
    const noPermit2 = { id: CHAIN_ID } as unknown as ExtendedChain
    await expect(
      checkPermitSupport(client, {
        chain: noPermit2,
        tokenAddress: TOKEN,
        ownerAddress: OWNER,
        amount: AMOUNT,
      })
    ).resolves.toMatchObject({ permit2AllowanceSufficient: false })
    expect(canAccountUsePermit2).not.toHaveBeenCalled()
    expect(getAllowance).not.toHaveBeenCalled()
  })
})

describe('checkPermitSupport — native permit is independent of the Permit2 gate', () => {
  it('reports native permit support even when the signer cannot use Permit2', async () => {
    // The two gates are independent: `checkPermitSupport` reports native permit
    // support from `getNativePermit`, which applies its own signer check. A
    // Permit2 verdict must not leak across and suppress it.
    vi.mocked(canAccountUsePermit2).mockResolvedValue(false)
    vi.mocked(getActionWithFallback).mockResolvedValue({
      primaryType: 'Permit',
    } as never)

    await expect(subject()).resolves.toEqual({
      nativePermitSupported: true,
      permit2AllowanceSufficient: false,
    })
  })
})
