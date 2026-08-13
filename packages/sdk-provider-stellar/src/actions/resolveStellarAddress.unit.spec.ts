import { Keypair } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolve = vi.fn()

vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual<typeof import('@stellar/stellar-sdk')>(
    '@stellar/stellar-sdk'
  )
  return {
    ...actual,
    Federation: {
      Server: { resolve: (...args: unknown[]) => resolve(...args) },
    },
  }
})

const { resolveStellarAddress } = await import('./resolveStellarAddress.js')

const ACCOUNT = Keypair.random().publicKey()

describe('resolveStellarAddress', () => {
  beforeEach(() => {
    resolve.mockReset()
  })

  it('returns a G-address unchanged and never calls federation', async () => {
    await expect(resolveStellarAddress(ACCOUNT)).resolves.toBe(ACCOUNT)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('ignores anything that is not a federation address', async () => {
    await expect(
      resolveStellarAddress('not-an-address')
    ).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('resolves a federation address with no memo', async () => {
    resolve.mockResolvedValue({ account_id: ACCOUNT })

    await expect(resolveStellarAddress('alice*lifi.io')).resolves.toBe(ACCOUNT)
  })

  // A memo is part of the destination for a custodial account. Neither the SDK
  // nor the route request can carry one, so resolving to the bare pooled
  // address would deliver funds no exchange could attribute.
  it('refuses to resolve when the record requires a memo', async () => {
    resolve.mockResolvedValue({
      account_id: ACCOUNT,
      memo: '123456',
      memo_type: 'id',
    })

    await expect(
      resolveStellarAddress('alice*exchange.com')
    ).resolves.toBeUndefined()
  })

  // The record comes from an arbitrary remote server; a muxed M-address would
  // otherwise slip past the G-address-only rule the provider enforces.
  it('rejects an account_id that is not a G-address', async () => {
    resolve.mockResolvedValue({ account_id: 'MABCDEF' })

    await expect(
      resolveStellarAddress('alice*lifi.io')
    ).resolves.toBeUndefined()
  })

  it('returns undefined when the federation server fails', async () => {
    resolve.mockRejectedValue(new Error('502'))

    await expect(
      resolveStellarAddress('alice*lifi.io')
    ).resolves.toBeUndefined()
  })
})
