import {
  getRelayedTransactionStatus,
  LiFiErrorCode,
  type LiFiStep,
  type SDKClient,
  TransactionError,
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

const DAY_MS = 24 * 60 * 60_000

type Outcome = { settled: boolean; error?: unknown }

// Records how the wait settles without awaiting it, so a wait that never
// ends fails the assertions instead of hanging the test.
const track = (promise: Promise<unknown>): Outcome => {
  const outcome: Outcome = { settled: false }
  promise.then(
    () => {
      outcome.settled = true
    },
    (error: unknown) => {
      outcome.settled = true
      outcome.error = error
    }
  )
  return outcome
}

const relayerAnswersPending = (): void => {
  vi.mocked(getRelayedTransactionStatus).mockResolvedValue({
    status: 'PENDING',
  } as never)
}

/** Advances one more minute and checks that no status request started. */
const expectNoMoreRequests = async (): Promise<void> => {
  const callsAtEnd = vi.mocked(getRelayedTransactionStatus).mock.calls.length
  await vi.advanceTimersByTimeAsync(60_000)
  expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(callsAtEnd)
}

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

describe('waitForRelayedTransactionReceipt — timeout', () => {
  // The deadline ends the wait, not the transaction: the relayer may still
  // execute the task. The error is not final, so the action keeps its task
  // id and a resume waits for the same task instead of signing again.
  const expectTimedOut = (outcome: Outcome): void => {
    expect(outcome.settled).toBe(true)
    expect(outcome.error).toBeInstanceOf(TransactionError)
    expect(outcome.error).toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Relayed transaction timed out waiting for a result.',
      final: false,
    })
    expect(vi.getTimerCount()).toBe(0)
  }

  it('rejects with a non-final TransactionFailed after 24 hours of PENDING by default', async () => {
    vi.useFakeTimers()
    relayerAnswersPending()
    const start = Date.now()

    const outcome = track(run())
    // Move the clock to 10 s before the default timeout instead of running
    // 17 000 polls. Pending timers keep their delays.
    vi.setSystemTime(start + DAY_MS - 10_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(outcome.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(15_000)

    expectTimedOut(outcome)
    await expectNoMoreRequests()
  })

  it('rejects with a non-final TransactionFailed after a given timeout', async () => {
    vi.useFakeTimers()
    relayerAnswersPending()

    const outcome = track(
      waitForRelayedTransactionReceipt({} as SDKClient, TASK_ID, step, 60_000)
    )
    await vi.advanceTimersByTimeAsync(60_000 + 10_000)

    expectTimedOut(outcome)
    await expectNoMoreRequests()
  })
})

describe('waitForRelayedTransactionReceipt — signal', () => {
  it('ends during the sleep with the abort reason when the signal aborts', async () => {
    vi.useFakeTimers()
    relayerAnswersPending()
    const controller = new AbortController()

    const outcome = track(
      waitForRelayedTransactionReceipt(
        {} as SDKClient,
        TASK_ID,
        step,
        undefined,
        controller.signal
      )
    )
    await vi.advanceTimersByTimeAsync(12_000)
    expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(3)

    const reason = new Error('stopped')
    controller.abort(reason)
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome).toEqual({ settled: true, error: reason })
    expect(vi.getTimerCount()).toBe(0)
    await expectNoMoreRequests()
  })

  it('ends a status request in flight with the abort reason when the signal aborts', async () => {
    vi.useFakeTimers()
    // Like `fetch`: the request rejects once its signal aborts.
    vi.mocked(getRelayedTransactionStatus).mockImplementation(
      (_client, _params, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(options.signal?.reason)
          )
        })
    )
    const controller = new AbortController()

    const outcome = track(
      waitForRelayedTransactionReceipt(
        {} as SDKClient,
        TASK_ID,
        step,
        undefined,
        controller.signal
      )
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(1)
    expect(getRelayedTransactionStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: TASK_ID }),
      { signal: controller.signal }
    )

    const reason = new Error('stopped')
    controller.abort(reason)
    await vi.advanceTimersByTimeAsync(0)

    // Not `TransactionNotFound`: the error of a request the abort cut short
    // is not retried.
    expect(outcome).toEqual({ settled: true, error: reason })
    expect(vi.getTimerCount()).toBe(0)
    await expectNoMoreRequests()
  })
})
