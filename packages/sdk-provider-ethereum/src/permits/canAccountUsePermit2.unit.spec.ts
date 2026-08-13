import type { SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../actions/getAccountCode.js', () => ({
  getAccountCode: vi.fn(),
}))
vi.mock('viem/actions', () => ({ call: vi.fn() }))
vi.mock('../client/publicClient.js', () => ({ getPublicClient: vi.fn() }))

import { call } from 'viem/actions'
import { getAccountCode } from '../actions/getAccountCode.js'
import { getPublicClient } from '../client/publicClient.js'
import { canAccountUsePermit2 } from './canAccountUsePermit2.js'

const client = {} as SDKClient
const ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const CHAIN_ID = 4663

// Real delegation designators from the JUMEMB-32 investigation.
const ALCHEMY_7702 =
  '0xef010069007702764179f14f51cdce752f4f775d74e139' as `0x${string}`
const METAMASK_7702 =
  '0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b' as `0x${string}`

// What an ecrecover-based account returns for a signature that isn't its own.
const SIG_VALIDATION_FAILED =
  '0xffffffff00000000000000000000000000000000000000000000000000000000' as `0x${string}`

const subject = () =>
  canAccountUsePermit2(client, { chainId: CHAIN_ID, address: ADDRESS })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPublicClient).mockResolvedValue({} as never)
})

describe('canAccountUsePermit2 — accounts without code', () => {
  it('allows a plain EOA and never probes (Permit2 uses ecrecover)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x')

    expect(await subject()).toBe(true)
    expect(call).not.toHaveBeenCalled()
  })
})

describe('canAccountUsePermit2 — code-bearing accounts are probed, not assumed', () => {
  it('allows an EIP-7702 account whose isValidSignature evaluates raw ECDSA', async () => {
    // MetaMask's EIP7702StatelessDeleGator: `ECDSA.recover(...) == address(this)`,
    // so it returns SIG_VALIDATION_FAILED for our probe and the magic value for
    // the real signature. Permit2 works — blocking it would cost these users an
    // approval transaction for nothing.
    vi.mocked(getAccountCode).mockResolvedValue(METAMASK_7702)
    vi.mocked(call).mockResolvedValue({ data: SIG_VALIDATION_FAILED })

    expect(await subject()).toBe(true)
  })

  it('blocks an ERC-6900 account whose isValidSignature reverts', async () => {
    // Alchemy's SemiModularAccount7702 rejects the signature envelope before
    // recovery. This is the JUMEMB-32 failure.
    vi.mocked(getAccountCode).mockResolvedValue(ALCHEMY_7702)
    vi.mocked(call).mockRejectedValue(new Error('execution reverted'))

    expect(await subject()).toBe(false)
  })

  it('blocks an account that decodes the call but returns nothing', async () => {
    // Permit2 compares the return against its magic value, so an empty return
    // fails there too.
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    vi.mocked(call).mockResolvedValue({ data: '0x' })

    expect(await subject()).toBe(false)
  })

  it('blocks a smart-contract wallet that reverts (Safe and friends)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    vi.mocked(call).mockRejectedValue(new Error('execution reverted'))

    expect(await subject()).toBe(false)
  })

  it('probes the account under test on the chain being queried', async () => {
    vi.mocked(getAccountCode).mockResolvedValue(ALCHEMY_7702)
    vi.mocked(call).mockResolvedValue({ data: SIG_VALIDATION_FAILED })

    await subject()

    expect(getPublicClient).toHaveBeenCalledWith(client, CHAIN_ID)
    expect(call).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: ADDRESS })
    )
  })

  it('blocks an account whose return is too short to be a magic value', async () => {
    // A bare 4-byte return, not padded to a word. Permit2 could not decode it,
    // so accepting it here would only manufacture a false positive.
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    vi.mocked(call).mockResolvedValue({ data: '0x1626ba7e' })

    expect(await subject()).toBe(false)
  })

  it('blocks a return one byte short of a full word', async () => {
    // 31 bytes, not 32 — pins the boundary at exactly one word.
    vi.mocked(getAccountCode).mockResolvedValue('0x6080' as `0x${string}`)
    vi.mocked(call).mockResolvedValue({
      data: `0x${'ab'.repeat(31)}` as `0x${string}`,
    })

    expect(await subject()).toBe(false)
  })

  it('never follows a CCIP-Read revert while probing', async () => {
    // Following an `OffchainLookup` revert would turn a revert into a return,
    // inverting the rule the probe is keyed on.
    vi.mocked(getAccountCode).mockResolvedValue(ALCHEMY_7702)
    vi.mocked(call).mockResolvedValue({ data: SIG_VALIDATION_FAILED })
    // Sentinel, so the assertion also catches a client replaced rather than
    // cloned — the shared `{}` mock would let that pass.
    vi.mocked(getPublicClient).mockResolvedValue({
      uid: 'probe-client',
    } as never)

    await subject()

    // viem takes `ccipRead` from the client, so assert on the first argument.
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'probe-client', ccipRead: false }),
      expect.anything()
    )
  })
})

describe('canAccountUsePermit2 — failure handling', () => {
  it('blocks when the code lookup fails (RPC down)', async () => {
    vi.mocked(getAccountCode).mockResolvedValue(undefined)

    expect(await subject()).toBe(false)
    expect(call).not.toHaveBeenCalled()
  })

  it('blocks when the probe itself fails for transport reasons', async () => {
    // Indistinguishable from a revert, and both must fail closed.
    vi.mocked(getAccountCode).mockResolvedValue(ALCHEMY_7702)
    vi.mocked(getPublicClient).mockRejectedValue(new Error('no rpc'))

    expect(await subject()).toBe(false)
  })
})
