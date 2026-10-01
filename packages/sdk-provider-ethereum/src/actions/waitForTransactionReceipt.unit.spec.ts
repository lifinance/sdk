import { LiFiErrorCode, type SDKClient } from '@lifi/sdk'
import type {
  Client,
  Hash,
  ReplacementReason,
  ReplacementReturnType,
  TransactionReceipt,
} from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('viem/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/actions')>()
  return { ...actual, waitForTransactionReceipt: vi.fn() }
})

vi.mock('../client/publicClient.js', () => ({
  getPublicClient: vi.fn(),
}))

import { waitForTransactionReceipt as viemWaitForTransactionReceipt } from 'viem/actions'
import { getPublicClient } from '../client/publicClient.js'
import { waitForTransactionReceipt } from './waitForTransactionReceipt.js'

const TX_HASH = `0x${'ab'.repeat(32)}` as Hash
const REPLACEMENT_HASH = `0x${'cd'.repeat(32)}` as Hash

const receipt = (
  status: 'success' | 'reverted',
  transactionHash: Hash = TX_HASH
): TransactionReceipt =>
  ({ status, transactionHash }) as unknown as TransactionReceipt

/** viem reports the replacement, then resolves with the replacement's receipt. */
const replacedWith = (reason: ReplacementReason): void => {
  vi.mocked(viemWaitForTransactionReceipt).mockImplementation((async (
    _client: Client,
    parameters: { onReplaced?: (response: ReplacementReturnType) => void }
  ) => {
    parameters.onReplaced?.({
      reason,
      transaction: { hash: REPLACEMENT_HASH },
    } as unknown as ReplacementReturnType)
    return receipt('success', REPLACEMENT_HASH)
  }) as never)
}

const run = (): Promise<TransactionReceipt | undefined> =>
  waitForTransactionReceipt({} as SDKClient, {
    client: {} as Client,
    chainId: 1,
    txHash: TX_HASH,
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPublicClient).mockResolvedValue({} as Client)
})

describe('waitForTransactionReceipt', () => {
  it('marks a reverted receipt as a final failure', async () => {
    vi.mocked(viemWaitForTransactionReceipt).mockResolvedValue(
      receipt('reverted') as never
    )

    await expect(run()).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction was reverted.',
      final: true,
    })
  })

  it.each(['cancelled', 'replaced'] as const)(
    'marks a %s transaction as a final failure',
    async (reason) => {
      replacedWith(reason)

      await expect(run()).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionCanceled,
        message: 'Transaction was canceled or replaced.',
        final: true,
      })
    }
  )

  it('lets a repriced transaction continue', async () => {
    replacedWith('repriced')

    await expect(run()).resolves.toMatchObject({
      status: 'success',
      transactionHash: REPLACEMENT_HASH,
    })
  })

  // RPC errors are an unknown outcome: no error at all, the step continues to
  // the status task, which keys on the hash.
  it('returns undefined instead of an error when no client finds a receipt', async () => {
    vi.mocked(viemWaitForTransactionReceipt).mockRejectedValue(
      new Error('rpc unavailable')
    )

    await expect(run()).resolves.toBeUndefined()
    expect(getPublicClient).toHaveBeenCalledTimes(1)
  })
})
