import {
  getRelayedTransactionStatus,
  LiFiErrorCode,
  type LiFiStep,
  type SDKClient,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return { ...actual, getRelayedTransactionStatus: vi.fn() }
})

import { waitForRelayedTransactionReceipt } from './waitForRelayedTransactionReceipt.js'

const TASK_ID = `0x${'ab'.repeat(32)}` as Hash
const step = {
  tool: 'lifi',
  action: { fromChainId: 1, toChainId: 1 },
} as unknown as LiFiStep

const run = (): Promise<unknown> =>
  waitForRelayedTransactionReceipt({} as SDKClient, TASK_ID, step)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForRelayedTransactionReceipt', () => {
  it('marks a relayed FAILED status as final and does not retry it', async () => {
    vi.mocked(getRelayedTransactionStatus).mockResolvedValue({
      status: 'FAILED',
    } as never)

    await expect(run()).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction was reverted.',
      final: true,
    })
    // The `shouldRetry` predicate keys on `TransactionFailed`: one call only.
    expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(1)
  })

  it('leaves an unknown relayer status unknown after its retries', async () => {
    vi.useFakeTimers()
    vi.mocked(getRelayedTransactionStatus).mockResolvedValue({
      status: 'NOT_FOUND',
    } as never)

    const outcome = run().then(
      () => undefined,
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await outcome).toMatchObject({
      code: LiFiErrorCode.TransactionNotFound,
      message: 'Transaction not found.',
      final: false,
    })
    expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(3)
  })
})
