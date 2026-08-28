import type { SDKClient } from '@lifi/sdk'
import type { Address } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('viem/actions', () => ({ call: vi.fn() }))
vi.mock('../client/publicClient.js', () => ({ getPublicClient: vi.fn() }))

import { call } from 'viem/actions'
import { getPublicClient } from '../client/publicClient.js'
import { acceptsRawEcdsaSignature } from './acceptsRawEcdsaSignature.js'

const client = {} as SDKClient
const ADDRESS = '0xaaaa000000000000000000000000000000000001' as Address
const CHAIN_ID = 42161

// A bytes4 padded to a full word — what an ecrecover-based account returns for a
// signature that is not its own.
const SIG_VALIDATION_FAILED =
  '0xffffffff00000000000000000000000000000000000000000000000000000000' as `0x${string}`
const MAGIC_VALUE =
  '0x1626ba7e00000000000000000000000000000000000000000000000000000000' as `0x${string}`

const subject = () => acceptsRawEcdsaSignature(client, CHAIN_ID, ADDRESS)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPublicClient).mockResolvedValue({} as never)
})

describe('acceptsRawEcdsaSignature — revert vs return is the whole signal', () => {
  it('accepts a returned failure value: the account parsed the signature', async () => {
    vi.mocked(call).mockResolvedValue({ data: SIG_VALIDATION_FAILED })
    expect(await subject()).toBe(true)
  })

  it('accepts a returned magic value', async () => {
    // The probe signature is a third party's, so this is unexpected — but an
    // account that says yes to everything will not reject the real signature.
    vi.mocked(call).mockResolvedValue({ data: MAGIC_VALUE })
    expect(await subject()).toBe(true)
  })

  it('rejects a revert: the envelope was refused before recovery', async () => {
    vi.mocked(call).mockRejectedValue(new Error('execution reverted'))
    expect(await subject()).toBe(false)
  })
})

describe('acceptsRawEcdsaSignature — returns too short to be a verdict', () => {
  it.each([
    ['empty', '0x'],
    ['a bare bytes4, unpadded', '0x1626ba7e'],
    ['31 bytes, one short of a word', `0x${'ab'.repeat(31)}`],
  ])('rejects %s', async (_label, data) => {
    vi.mocked(call).mockResolvedValue({ data: data as `0x${string}` })
    expect(await subject()).toBe(false)
  })
})

describe('acceptsRawEcdsaSignature — call shape', () => {
  it('probes the given address on the given chain', async () => {
    vi.mocked(call).mockResolvedValue({ data: SIG_VALIDATION_FAILED })

    await subject()

    expect(getPublicClient).toHaveBeenCalledWith(client, CHAIN_ID)
    expect(call).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: ADDRESS })
    )
  })

  it('disables CCIP-Read on a clone of the client, not the shared client', async () => {
    // Following an `OffchainLookup` revert would surface as a return and invert
    // the signal. The sentinel also catches a client replaced rather than cloned.
    vi.mocked(call).mockResolvedValue({ data: SIG_VALIDATION_FAILED })
    const shared = { uid: 'shared-client' } as never
    vi.mocked(getPublicClient).mockResolvedValue(shared)

    await subject()

    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'shared-client', ccipRead: false }),
      expect.anything()
    )
    expect(shared).not.toHaveProperty('ccipRead')
  })

  it('rejects when the client cannot be built', async () => {
    vi.mocked(getPublicClient).mockRejectedValue(new Error('no rpc'))
    expect(await subject()).toBe(false)
    expect(call).not.toHaveBeenCalled()
  })
})
