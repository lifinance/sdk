import {
  isFinalTransactionError,
  LiFiErrorCode,
  TransactionError,
} from '@lifi/sdk'
import { type Client, type Hash, UnknownBundleIdError } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForBatchTransactionReceipt } from './waitForBatchTransactionReceipt.js'

const BATCH_ID = `0x${'ba'.repeat(32)}` as Hash
const TX_HASH = `0x${'ab'.repeat(32)}` as Hash

/**
 * `getAction` prefers a method of the same name on the client — the seam the
 * flow harness uses as well — so no `vi.mock('viem/actions')` is needed.
 */
const clientReturning = (result: Record<string, unknown>): Client =>
  ({
    waitForCallsStatus: vi.fn().mockResolvedValue(result),
  }) as unknown as Client

describe('waitForBatchTransactionReceipt', () => {
  it('marks a batch with a reverted call as a final failure', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({
      status: 'success',
      statusCode: 200,
      receipts: [{ status: 'reverted', transactionHash: TX_HASH }],
    })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, { onFailed })
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction was reverted.',
      final: true,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  // Status 200 means the wallet reports the batch as executed. Without a
  // complete set of receipts that proves nothing: the outcome stays unknown.
  it('leaves a successful batch without receipts unknown', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({
      status: 'success',
      statusCode: 200,
      receipts: [],
    })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, { onFailed })
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction was reverted.',
      final: false,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('leaves a successful batch with a receipt without a hash unknown', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({
      status: 'success',
      statusCode: 200,
      receipts: [
        { status: 'success', transactionHash: TX_HASH },
        { status: 'success' },
      ],
    })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, { onFailed })
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction was reverted.',
      final: false,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('marks a batch the wallet did not include (4xx) as a final failure', async () => {
    const client = clientReturning({ status: 'failure', statusCode: 400 })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionCanceled,
      message: 'Transaction was canceled.',
      final: true,
    })
  })

  it('marks a batch that reverted completely (500) as a final failure', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({ status: 'failure', statusCode: 500 })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, { onFailed })
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction failed.',
      final: true,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  // Some calls of a partial batch may be onchain.
  it('leaves a partially reverted batch (600) unknown', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({ status: 'failure', statusCode: 600 })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, { onFailed })
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction failed.',
      final: false,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  // viem maps 300–699 to `failure` and leaves codes from 700 without a status.
  it.each([
    { status: 'failure', statusCode: 300 },
    { status: 'failure', statusCode: 501 },
    { status: undefined, statusCode: 700 },
  ])(
    'leaves a batch with the undefined code $statusCode unknown',
    async (result) => {
      const onFailed = vi.fn()
      const client = clientReturning(result)

      await expect(
        waitForBatchTransactionReceipt(client, BATCH_ID, { onFailed })
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionFailed,
        message: 'Transaction failed.',
        final: false,
      })
      expect(onFailed).toHaveBeenCalledTimes(1)
    }
  )

  it('leaves a wallet error unknown', async () => {
    const walletError = new Error('wallet_getCallsStatus timed out')
    const client = {
      waitForCallsStatus: vi.fn().mockRejectedValue(walletError),
    } as unknown as Client

    const thrown = await waitForBatchTransactionReceipt(client, BATCH_ID).catch(
      (error: unknown) => error
    )

    expect(thrown).toBe(walletError)
    expect(isFinalTransactionError(thrown)).toBe(false)
  })
})

describe('waitForBatchTransactionReceipt: the status predicate', () => {
  // viem's default for `status`, pinned: viem's documentation says
  // `statusCode >= 200`, its code stops on 200 and from 300.
  it('stops on 200 and from 300, and polls on otherwise', async () => {
    const waitForCallsStatus = vi.fn().mockResolvedValue({
      status: 'success',
      statusCode: 200,
      receipts: [{ status: 'success', transactionHash: TX_HASH }],
    })
    const client = { waitForCallsStatus } as unknown as Client

    await waitForBatchTransactionReceipt(client, BATCH_ID)

    const [{ id, timeout, status }] = waitForCallsStatus.mock.calls[0]
    expect({ id, timeout }).toEqual({ id: BATCH_ID, timeout: 86_400_000 })
    expect(typeof status).toBe('function')
    const stopsOn = Object.fromEntries(
      [100, 199, 200, 201, 299, 300, 400, 500, 600, 700].map((statusCode) => [
        statusCode,
        status({ statusCode }),
      ])
    )
    expect(stopsOn).toEqual({
      100: false,
      199: false,
      200: true,
      201: false,
      299: false,
      300: true,
      400: true,
      500: true,
      600: true,
      700: true,
    })
  })
})

// MetaMask returns the id of a single-call bundle before the user approves
// it. After a reject it removes the bundle, and `wallet_getCallsStatus`
// fails with 5730. These tests run viem's real `waitForCallsStatus`. A
// bundle has one call unless a test says otherwise.
describe('waitForBatchTransactionReceipt: a bundle the wallet does not know', () => {
  const POLL_MS = 1_000
  // Longer than every poll and retry here: viem retries a failed request 4
  // times within about 3 s.
  const SETTLE_MS = 30_000
  const TEN_MINUTES_MS = 10 * 60_000

  const PENDING = { status: 'pending', statusCode: 100, receipts: [] }
  const SUCCEEDED = {
    status: 'success',
    statusCode: 200,
    receipts: [{ status: 'success', transactionHash: TX_HASH }],
  }

  const unknownBundle = (): UnknownBundleIdError =>
    new UnknownBundleIdError(new Error('No matching bundle found'))

  /** A wallet answer, or a function that returns one when the wallet is asked. */
  type Answer =
    | Record<string, unknown>
    | Error
    | (() => Record<string, unknown> | Error)

  let walletCount = 0

  /**
   * `getAction` finds `getCallsStatus` on the client, so every request,
   * retries included, takes the next answer, and the last answer repeats.
   * viem shares one poll between waits for the same client `uid` and id, so
   * each wallet gets its own `uid`.
   */
  const walletAnswering = (
    ...answers: Answer[]
  ): { client: Client; getCallsStatus: ReturnType<typeof vi.fn> } => {
    walletCount += 1
    const getCallsStatus = vi.fn(async () => {
      const next = answers.length > 1 ? answers.shift()! : answers[0]
      const answer = typeof next === 'function' ? next() : next
      if (answer instanceof Error) {
        throw answer
      }
      return answer
    })
    const client = {
      uid: `wallet-${walletCount}`,
      pollingInterval: POLL_MS,
      getCallsStatus,
    } as unknown as Client
    return { client, getCallsStatus }
  }

  interface Outcome {
    settled: boolean
    value?: unknown
    error?: unknown
  }

  const track = (promise: Promise<unknown>): Outcome => {
    const outcome: Outcome = { settled: false }
    promise.then(
      (value) => {
        Object.assign(outcome, { settled: true, value })
      },
      (error: unknown) => {
        Object.assign(outcome, { settled: true, error })
      }
    )
    return outcome
  }

  const settle = async (promise: Promise<unknown>): Promise<Outcome> => {
    const outcome = track(promise)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(outcome.settled).toBe(true)
    return outcome
  }

  const expectBundleNotFound = (error: unknown): void => {
    expect(error).toBeInstanceOf(TransactionError)
    expect(error).toMatchObject({
      code: 1028,
      message: 'The wallet has no record of the call bundle.',
    })
    expect(isFinalTransactionError(error)).toBe(false)
    expect((error as Error).cause).toBeInstanceOf(UnknownBundleIdError)
  }

  // A final rejection: the SDK treats the bundle as never sent.
  const expectDropped = (error: unknown): void => {
    expect(error).toBeInstanceOf(TransactionError)
    expect(error).toMatchObject({
      code: LiFiErrorCode.SignatureRejected,
      message:
        'The wallet has no record of the call bundle. The SDK treats it as never sent.',
    })
    expect(isFinalTransactionError(error)).toBe(true)
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    { shape: "viem's UnknownBundleIdError", error: unknownBundle },
    {
      shape: 'an error caused by it',
      error: () => new Error('Request failed.', { cause: unknownBundle() }),
    },
    {
      shape: 'an error with the code 5730',
      error: () =>
        Object.assign(new Error('No matching bundle found'), { code: 5730 }),
    },
  ])(
    'reports a bundle as dropped when the wallet answered for it and then no longer knows it ($shape)',
    async ({ error }) => {
      const onFailed = vi.fn()
      const unknown = error()
      const { client } = walletAnswering(PENDING, unknown)

      const outcome = await settle(
        waitForBatchTransactionReceipt(client, BATCH_ID, {
          onFailed,
          signedAt: Date.now(),
          callCount: 1,
        })
      )

      expectDropped(outcome.error)
      expect((outcome.error as Error).cause).toBe(unknown)
      expect(onFailed).not.toHaveBeenCalled()
    }
  )

  // Signed just now: only the missing first answer keeps it from a drop.
  it('fails with CallBundleNotFound when the first answer is an unknown bundle', async () => {
    const { client } = walletAnswering(unknownBundle())

    const outcome = await settle(
      waitForBatchTransactionReceipt(client, BATCH_ID, {
        signedAt: Date.now(),
        callCount: 1,
      })
    )

    expectBundleNotFound(outcome.error)
  })

  // The wallet answers 100 first in each case: only the signing time keeps
  // the bundle from a drop.
  it.each([
    { signed: 'exactly 10 minutes before the answer', age: TEN_MINUTES_MS },
    { signed: 'an hour before the answer', age: 6 * TEN_MINUTES_MS },
    { signed: '1 ms after the answer (a clock ahead)', age: -1 },
    { signed: 'at an unknown time', age: undefined },
  ])(
    'fails with CallBundleNotFound for a bundle signed $signed',
    async ({ age }) => {
      const answerAt = Date.now() + 60_000
      const { client } = walletAnswering(PENDING, () => {
        vi.setSystemTime(answerAt)
        return unknownBundle()
      })
      const signedAt = age === undefined ? undefined : answerAt - age

      const outcome = await settle(
        waitForBatchTransactionReceipt(client, BATCH_ID, {
          signedAt,
          callCount: 1,
        })
      )

      expectBundleNotFound(outcome.error)
    }
  )

  it.each([
    { signed: 'at the answer', age: 0 },
    {
      signed: '1 ms less than 10 minutes before the answer',
      age: TEN_MINUTES_MS - 1,
    },
  ])('reports a bundle signed $signed as dropped', async ({ age }) => {
    const answerAt = Date.now() + 60_000
    const { client } = walletAnswering(PENDING, () => {
      vi.setSystemTime(answerAt)
      return unknownBundle()
    })

    const outcome = await settle(
      waitForBatchTransactionReceipt(client, BATCH_ID, {
        signedAt: answerAt - age,
        callCount: 1,
      })
    )

    expectDropped(outcome.error)
  })

  // MetaMask returns the id of a bundle of two or more calls only after it
  // sent the bundle. A wallet that then has no record of it removed a sent
  // bundle (e.g. "Delete activity and nonce data"), which can still land.
  // Without a stored count the SDK cannot know the kind of bundle.
  it.each([
    { calls: 'two calls', callCount: 2 },
    { calls: 'an unknown number of calls', callCount: undefined },
  ])(
    'fails with CallBundleNotFound, never a drop, for a bundle of $calls that the wallet answered for',
    async ({ callCount }) => {
      const onFailed = vi.fn()
      const { client, getCallsStatus } = walletAnswering(
        PENDING,
        unknownBundle()
      )

      const outcome = await settle(
        waitForBatchTransactionReceipt(client, BATCH_ID, {
          onFailed,
          signedAt: Date.now(),
          callCount,
        })
      )

      expectBundleNotFound(outcome.error)
      // The wallet answered 100 first: only the count keeps it from a drop.
      expect(getCallsStatus.mock.calls.length).toBeGreaterThan(1)
      expect(onFailed).not.toHaveBeenCalled()
    }
  )

  it('returns the receipt of a bundle that is pending and then succeeds, as before', async () => {
    const onFailed = vi.fn()
    const { client, getCallsStatus } = walletAnswering(PENDING, SUCCEEDED)

    const outcome = await settle(
      waitForBatchTransactionReceipt(client, BATCH_ID, {
        onFailed,
        signedAt: Date.now(),
        callCount: 1,
      })
    )

    expect(outcome).toEqual({
      settled: true,
      value: { status: 'success', transactionHash: TX_HASH },
    })
    expect(getCallsStatus).toHaveBeenCalledTimes(2)
    expect(onFailed).not.toHaveBeenCalled()
  })

  // A retry inside one poll is not a new answer: the wallet answers with the
  // receipt, and the wait ends as before.
  it.each([
    { after: 'a pending answer', answers: [PENDING] },
    { after: 'no answer', answers: [] },
  ])(
    'returns the receipt when a retry after an unknown bundle succeeds, after $after',
    async ({ answers }) => {
      const onFailed = vi.fn()
      const { client } = walletAnswering(...answers, unknownBundle(), SUCCEEDED)

      const outcome = await settle(
        waitForBatchTransactionReceipt(client, BATCH_ID, {
          onFailed,
          signedAt: Date.now(),
          callCount: 1,
        })
      )

      expect(outcome).toEqual({
        settled: true,
        value: { status: 'success', transactionHash: TX_HASH },
      })
      expect(onFailed).not.toHaveBeenCalled()
    }
  )

  it('rethrows any other wallet error unchanged after a pending answer', async () => {
    const walletError = new Error('wallet_getCallsStatus timed out')
    const { client } = walletAnswering(PENDING, walletError)

    const outcome = await settle(
      waitForBatchTransactionReceipt(client, BATCH_ID, {
        signedAt: Date.now(),
        callCount: 1,
      })
    )

    expect(outcome.error).toBe(walletError)
    expect(isFinalTransactionError(outcome.error)).toBe(false)
  })

  // viem shares one poll between waits for the same client and id, and calls
  // only the predicate of the wait that started the poll.
  it('reports CallBundleNotFound, never a drop, to a wait that joined the poll of another wait', async () => {
    const signedAt = Date.now()
    const { client, getCallsStatus } = walletAnswering(PENDING, unknownBundle())

    const first = track(
      waitForBatchTransactionReceipt(client, BATCH_ID, {
        signedAt,
        callCount: 1,
      })
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(getCallsStatus).toHaveBeenCalledTimes(1)
    const joined = track(
      waitForBatchTransactionReceipt(client, BATCH_ID, {
        signedAt,
        callCount: 1,
      })
    )
    await vi.advanceTimersByTimeAsync(0)
    // The joined wait did not start a poll of its own.
    expect(getCallsStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(SETTLE_MS)

    expectDropped(first.error)
    expectBundleNotFound(joined.error)
  })
})
