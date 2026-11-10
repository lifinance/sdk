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
  ])('answers false for %s without the Safe lookup', async (_, value) => {
    await expect(
      isSafeSignature({} as SDKClient, {
        hash: value as unknown as string,
        chainId: 1,
        address: ADDRESS,
      })
    ).resolves.toBe(false)
    expect(isSafeWallet).not.toHaveBeenCalled()
  })
})
