import type { SDKClient } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./isSafeWallet.js', () => ({
  isSafeWallet: vi.fn(),
}))

import { isSafeSignature } from './isSafeSignature.js'
import { isSafeWallet } from './isSafeWallet.js'

const ADDRESS = `0x${'33'.repeat(20)}` as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isSafeSignature', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an object', { hash: `0x${'11'.repeat(65)}` }],
    ['a long string that is not hex', `0x${'zz'.repeat(65)}`],
    ['a transaction hash', `0x${'22'.repeat(32)}`],
  ])('answers false for %s without the Safe lookup', async (_, value) => {
    await expect(
      isSafeSignature({} as SDKClient, {
        hash: value,
        chainId: 1,
        address: ADDRESS,
      })
    ).resolves.toBe(false)
    expect(isSafeWallet).not.toHaveBeenCalled()
  })

  it('answers false for a 65-byte hex signature without an address', async () => {
    await expect(
      isSafeSignature({} as SDKClient, {
        hash: `0x${'11'.repeat(65)}`,
        chainId: 1,
      })
    ).resolves.toBe(false)
    expect(isSafeWallet).not.toHaveBeenCalled()
  })

  it('asks the Safe lookup for a 65-byte hex signature', async () => {
    vi.mocked(isSafeWallet).mockResolvedValue(true)

    await expect(
      isSafeSignature(
        { getProvider: () => undefined } as unknown as SDKClient,
        {
          hash: `0x${'11'.repeat(65)}`,
          chainId: 1,
          address: ADDRESS,
        }
      )
    ).resolves.toBe(true)
    expect(isSafeWallet).toHaveBeenCalledOnce()
  })
})
