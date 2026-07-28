import type { SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../actions/getAccountCode.js', () => ({
  getAccountCode: vi.fn(),
}))

import { getAccountCode } from '../actions/getAccountCode.js'
import { canAccountUsePermit2 } from './canAccountUsePermit2.js'

const client = {} as SDKClient
const ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const CHAIN_ID = 4663

const SEVEN_SEVEN_ZERO_TWO =
  '0xef010069007702764179f14f51cdce752f4f775d74e139' as `0x${string}`

const subject = () =>
  canAccountUsePermit2(client, { chainId: CHAIN_ID, address: ADDRESS })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('canAccountUsePermit2 — truth table', () => {
  it('returns true for a plain EOA (no code)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x')
    expect(await subject()).toBe(true)
  })

  it('returns false for an EIP-7702 delegated EOA', async () => {
    // JUMEMB-32: Permit2's SignatureVerification branches on
    // `claimedSigner.code.length`, so a delegation designator sends it down
    // the EIP-1271 path where our plain ECDSA signature is rejected. This is
    // the case `canAccountUseNativePermits` deliberately allows and Permit2
    // must not — if these two ever agree again, the bug is back.
    vi.mocked(getAccountCode).mockResolvedValue(SEVEN_SEVEN_ZERO_TWO)
    expect(await subject()).toBe(false)
  })

  it('returns false for a smart-contract wallet', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    expect(await subject()).toBe(false)
  })
})

describe('canAccountUsePermit2 — failure handling', () => {
  it('returns false on RPC failure (code === undefined)', async () => {
    // "If unsure, don't use Permit2" — falling back to approve + execute costs
    // an extra approval but always works.
    vi.mocked(getAccountCode).mockResolvedValue(undefined)
    expect(await subject()).toBe(false)
  })

  it('queries the code on the chain the step executes on', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x')
    await subject()
    expect(getAccountCode).toHaveBeenCalledWith({
      client,
      chainId: CHAIN_ID,
      address: ADDRESS,
    })
  })
})
