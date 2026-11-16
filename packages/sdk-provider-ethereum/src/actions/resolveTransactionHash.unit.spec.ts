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
const SAFE_ADDRESS = `0x${'33'.repeat(20)}` as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveTransactionHash', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['an empty hex string', '0x'],
    ['a string that is not hex', 'pending'],
    ['a hex string shorter than a hash', '0x1234'],
    ['an object', { hash: TX_HASH }],
  ])('rejects %s from the wallet', async (_, value) => {
    vi.mocked(isSafeSignature).mockResolvedValue(false)

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
      message: expect.stringContaining('did not return a transaction hash'),
      final: false,
    })
    expect(waitForSafeTransactionExecution).not.toHaveBeenCalled()
  })

  it.each([
    ['a transaction hash', TX_HASH],
    ['a signature that the Safe lookup did not confirm', SIGNATURE],
    ['an odd-length hex string longer than a hash', `0x${'2'.repeat(65)}`],
  ])('returns %s unchanged', async (_, value) => {
    vi.mocked(isSafeSignature).mockResolvedValue(false)

    await expect(
      resolveTransactionHash({} as SDKClient, {} as Client, value as Hex, 1)
    ).resolves.toBe(value)
  })

  it('returns the hash of the transaction that the Safe executes', async () => {
    vi.mocked(isSafeSignature).mockResolvedValue(true)
    vi.mocked(waitForSafeTransactionExecution).mockResolvedValue(TX_HASH)

    await expect(
      resolveTransactionHash(
        {} as SDKClient,
        { account: { address: SAFE_ADDRESS } } as unknown as Client,
        SIGNATURE,
        1
      )
    ).resolves.toBe(TX_HASH)
    expect(waitForSafeTransactionExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chainId: 1,
        safeAddress: SAFE_ADDRESS,
        signature: SIGNATURE,
      })
    )
  })

  // The real `isSafeSignature` answers false without an address, so this site
  // cannot be reached in production. Pinned so that it stays unknown.
  it('leaves a Safe signature without a Safe address unknown', async () => {
    vi.mocked(isSafeSignature).mockResolvedValue(true)

    await expect(
      resolveTransactionHash({} as SDKClient, {} as Client, SIGNATURE, 1)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Safe address not available for transaction tracking.',
      final: false,
    })
    expect(waitForSafeTransactionExecution).not.toHaveBeenCalled()
  })
})
