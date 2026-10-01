import { LiFiErrorCode, type SDKClient } from '@lifi/sdk'
import type { Client, Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./isSafeSignature.js', () => ({
  isSafeSignature: vi.fn(),
}))

vi.mock('./waitForSafeTransactionExecution.js', () => ({
  waitForSafeTransactionExecution: vi.fn(),
}))

import { isSafeSignature } from './isSafeSignature.js'
import { resolveTransactionHash } from './resolveTransactionHash.js'
import { waitForSafeTransactionExecution } from './waitForSafeTransactionExecution.js'

const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveTransactionHash', () => {
  // The real `isSafeSignature` answers false without an address, so this site
  // cannot be reached in production. Pinned so that it stays unknown.
  it('leaves a Safe signature without a Safe address unknown', async () => {
    vi.mocked(isSafeSignature).mockResolvedValue(true)

    await expect(
      resolveTransactionHash({} as SDKClient, {} as Client, SIGNATURE, 1)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message:
        'Safe address or signature not available for transaction tracking.',
      final: false,
    })
    expect(waitForSafeTransactionExecution).not.toHaveBeenCalled()
  })
})
