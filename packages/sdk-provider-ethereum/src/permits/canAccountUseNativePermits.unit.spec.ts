import type { SDKClient } from '@lifi/sdk'
import type { Address, Client } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../actions/getAccountCode.js', () => ({
  getAccountCode: vi.fn(),
}))
vi.mock('./acceptsRawEcdsaSignature.js', () => ({
  acceptsRawEcdsaSignature: vi.fn(),
}))

import { getAccountCode } from '../actions/getAccountCode.js'
import { acceptsRawEcdsaSignature } from './acceptsRawEcdsaSignature.js'
import { canAccountUseNativePermits } from './canAccountUseNativePermits.js'

const sdkClient = {} as SDKClient
const ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address

const ALCHEMY_7702 =
  '0xef010069007702764179f14f51cdce752f4f775d74e139' as `0x${string}`
const METAMASK_7702 =
  '0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b' as `0x${string}`

const buildViemClient = (overrides?: {
  chainId?: number | undefined
  account?: unknown
}): Client =>
  ({
    chain:
      overrides?.chainId === undefined ? undefined : { id: overrides.chainId },
    account:
      overrides && 'account' in overrides
        ? overrides.account
        : { address: ADDRESS },
  }) as unknown as Client

const subject = () =>
  canAccountUseNativePermits(sdkClient, buildViemClient({ chainId: 42161 }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(acceptsRawEcdsaSignature).mockResolvedValue(true)
})

describe('canAccountUseNativePermits — accounts without code', () => {
  it('allows a plain EOA and never probes (the token uses ecrecover)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x')

    expect(await subject()).toBe(true)
    expect(acceptsRawEcdsaSignature).not.toHaveBeenCalled()
  })
})

describe('canAccountUseNativePermits — accounts with code are probed', () => {
  it('blocks an EIP-7702 account whose isValidSignature rejects raw ECDSA', async () => {
    // The regression: signing ECDSA is not the question, verification is. USDC's
    // `permit` routes through `SignatureChecker`, which branches on
    // `owner.code.length` exactly like Permit2, so Alchemy's
    // SemiModularAccount7702 reverts with "EIP2612: invalid signature".
    // Passing every 7702 account because "it can sign ECDSA" is what broke.
    vi.mocked(getAccountCode).mockResolvedValue(ALCHEMY_7702)
    vi.mocked(acceptsRawEcdsaSignature).mockResolvedValue(false)

    expect(await subject()).toBe(false)
  })

  it('still allows an EIP-7702 account that verifies raw ECDSA', async () => {
    // MetaMask's EIP7702StatelessDeleGator recovers the root key, so the permit
    // verifies. Blocking it would cost a needless approval.
    vi.mocked(getAccountCode).mockResolvedValue(METAMASK_7702)

    expect(await subject()).toBe(true)
    expect(acceptsRawEcdsaSignature).toHaveBeenCalledWith(
      sdkClient,
      42161,
      ADDRESS
    )
  })

  it('blocks a contract wallet on shape alone, without probing', async () => {
    // `beforeEach` leaves the probe returning `true`, so this fails if the shape
    // gate is removed. Forcing the probe to `false` here would pass either way.
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)

    expect(await subject()).toBe(false)
    expect(acceptsRawEcdsaSignature).not.toHaveBeenCalled()
  })

  it('blocks a contract wallet that returns a failure value instead of reverting', async () => {
    // The hole this shape gate closes. Such an account passes the probe — a
    // `bytes4` pads to a full word — so probing it would offer a native permit,
    // skip the approval, then throw in `encodeNativePermitData`'s
    // `parseSignature` once the wallet returned a non-65-byte signature.
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    vi.mocked(acceptsRawEcdsaSignature).mockResolvedValue(true)

    expect(await subject()).toBe(false)
    expect(acceptsRawEcdsaSignature).not.toHaveBeenCalled()
  })
})

describe('canAccountUseNativePermits — failure guards', () => {
  it('returns false when chainId is undefined and skips the RPC entirely', async () => {
    expect(await canAccountUseNativePermits(sdkClient, buildViemClient())).toBe(
      false
    )
    expect(getAccountCode).not.toHaveBeenCalled()
  })

  it('returns false when the client has no account, rather than throwing', async () => {
    expect(
      await canAccountUseNativePermits(
        sdkClient,
        buildViemClient({ chainId: 42161, account: undefined })
      )
    ).toBe(false)
    expect(getAccountCode).not.toHaveBeenCalled()
  })

  it('returns false on RPC failure (code === undefined)', async () => {
    // Locks "no permits if unsure". `getAccountCode` normalizes empty code to
    // `'0x'`, so `undefined` means the lookup failed — never "plain EOA".
    vi.mocked(getAccountCode).mockResolvedValue(undefined)

    expect(await subject()).toBe(false)
    expect(acceptsRawEcdsaSignature).not.toHaveBeenCalled()
  })
})
