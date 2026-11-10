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
const TX_HASH = `0x${'22'.repeat(32)}` as Hex

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveTransactionHash', () => {
  // Some wallets answer `eth_sendTransaction` with `null` or another value
  // that is not a hash, and viem passes it through unchanged (JUMPER-FRONT-BR).
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['an empty hex string', '0x'],
    ['a string that is not hex', 'pending'],
    ['a hex string shorter than a hash', '0x1234'],
    ['an object', { hash: TX_HASH }],
  ])('rejects %s from the wallet before the Safe check', async (_, value) => {
    await expect(
      resolveTransactionHash(
        {} as SDKClient,
        {} as Client,
        value as unknown as Hex,
        1
      )
    ).rejects.toMatchObject({
      name: 'TransactionError',
      code: LiFiErrorCode.TransactionFailed,
      final: false,
    })
    expect(isSafeSignature).not.toHaveBeenCalled()
    expect(waitForSafeTransactionExecution).not.toHaveBeenCalled()
  })

  it('returns a transaction hash that is not a Safe signature unchanged', async () => {
    vi.mocked(isSafeSignature).mockResolvedValue(false)

    await expect(
      resolveTransactionHash({} as SDKClient, {} as Client, TX_HASH, 1)
    ).resolves.toBe(TX_HASH)
  })

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
