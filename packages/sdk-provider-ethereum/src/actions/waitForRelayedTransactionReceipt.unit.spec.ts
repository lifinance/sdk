import {
  getRelayedTransactionStatus,
  getStatus,
  LiFiErrorCode,
  type LiFiStep,
  type SDKClient,
  TransactionError,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getRelayedTransactionStatus: vi.fn(),
    getStatus: vi.fn(),
  }
})

vi.mock('../client/publicClient.js', () => ({ getPublicClient: vi.fn() }))

import { getPublicClient } from '../client/publicClient.js'
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
  // Drops the queued answers a test left unused.
  vi.mocked(getRelayedTransactionStatus).mockReset()
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
    // An error the poll throws ends the wait: one call only.
    expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(1)
  })

  it('leaves the status unknown after five status errors in a row', async () => {
    vi.useFakeTimers()
    vi.mocked(getRelayedTransactionStatus)
      .mockResolvedValueOnce({ status: 'NOT_FOUND' } as never)
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue({ status: 'NOT_FOUND' } as never)

    const outcome = track(run())
    await vi.advanceTimersByTimeAsync(5_000 * 3)
    expect(outcome.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(outcome.settled).toBe(true)
    expect(outcome.error).toMatchObject({
      code: LiFiErrorCode.TransactionNotFound,
      message: 'Transaction not found.',
      final: false,
    })
    expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(5)
    await expectNoMoreRequests()
  })

  it('counts only status errors in a row: an answer resets the count', async () => {
    vi.useFakeTimers()
    const notFound = { status: 'NOT_FOUND' } as never
    const mock = vi.mocked(getRelayedTransactionStatus)
    for (let i = 0; i < 4; i++) {
      mock.mockResolvedValueOnce(notFound)
    }
    mock.mockResolvedValueOnce({ status: 'PENDING' } as never)
    for (let i = 0; i < 4; i++) {
      mock.mockResolvedValueOnce(notFound)
    }
    mock.mockResolvedValueOnce({
      status: 'DONE',
      sending: { txHash: `0x${'ef'.repeat(32)}` },
    } as never)

    const outcome = track(run())
    await vi.advanceTimersByTimeAsync(5_000 * 9)

    expect(outcome).toEqual({ settled: true })
    expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(10)
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

describe('waitForRelayedTransactionReceipt — development log', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('logs no failed request when the abort ended it', async () => {
    vi.useFakeTimers()
    vi.stubEnv('NODE_ENV', 'development')
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
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
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome.settled).toBe(true)
    expect(debug).not.toHaveBeenCalled()
  })

  it('still logs a failed request while the signal is live', async () => {
    vi.useFakeTimers()
    vi.stubEnv('NODE_ENV', 'development')
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const failure = new Error('relayer unavailable')
    vi.mocked(getRelayedTransactionStatus).mockRejectedValueOnce(failure)
    relayerAnswersPending()
    const controller = new AbortController()

    track(
      waitForRelayedTransactionReceipt(
        {} as SDKClient,
        TASK_ID,
        step,
        undefined,
        controller.signal
      )
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(debug).toHaveBeenCalledWith(
      'Fetching status from relayer failed.',
      failure
    )
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
  })
})

describe('waitForRelayedTransactionReceipt for a gasless step', () => {
  const TX_HASH = `0x${'cd'.repeat(32)}`
  // Only fields a stored route keeps: the selection must also work after a
  // page reload, when nothing else of the run is left.
  const gaslessStep = {
    tool: 'sushiswap',
    action: { fromChainId: 42161, toChainId: 42161 },
    estimate: {
      feeCosts: [{ name: 'LIFI Gasless Relay Fee', included: true }],
    },
  } as unknown as LiFiStep

  beforeEach(() => {
    vi.mocked(getStatus).mockReset()
  })

  const runGasless = (): Promise<unknown> =>
    waitForRelayedTransactionReceipt({} as SDKClient, TASK_ID, gaslessStep)

  const gaslessBridgeStep = {
    ...gaslessStep,
    action: { fromChainId: 42161, toChainId: 10 },
  } as unknown as LiFiStep
  const runBridge = (): Promise<unknown> =>
    waitForRelayedTransactionReceipt(
      {} as SDKClient,
      TASK_ID,
      gaslessBridgeStep
    )

  const statusAnswers = (...answers: unknown[]): void => {
    for (const answer of answers) {
      vi.mocked(getStatus).mockResolvedValueOnce(answer as never)
    }
  }

  it('polls /v1/status by taskId alone, never the relayer status', async () => {
    statusAnswers({
      status: 'DONE',
      sending: { txHash: TX_HASH, txLink: 'https://arbiscan.io/tx/x' },
    })

    await runGasless()

    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getStatus).mock.calls[0][1]).toEqual({ taskId: TASK_ID })
    expect(getRelayedTransactionStatus).not.toHaveBeenCalled()
  })

  it('keeps polling while the relay is PENDING without a transaction hash', async () => {
    vi.useFakeTimers()
    statusAnswers(
      { status: 'PENDING', sending: { chainId: 42161 } },
      {
        status: 'PENDING',
        substatus: 'WAIT_SOURCE_CONFIRMATIONS',
        sending: { txHash: TX_HASH },
      },
      { status: 'DONE', sending: { txHash: TX_HASH } }
    )

    const outcome = track(runGasless())
    await vi.advanceTimersByTimeAsync(5_000)
    expect(outcome.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(outcome).toEqual({ settled: true })
    expect(getStatus).toHaveBeenCalledTimes(3)
  })

  it('resolves with the source hash once a bridge transfer waits for the destination', async () => {
    statusAnswers({
      status: 'PENDING',
      substatus: 'WAIT_DESTINATION_TRANSACTION',
      sending: { txHash: TX_HASH, txLink: 'https://arbiscan.io/tx/x' },
    })

    await expect(runBridge()).resolves.toMatchObject({
      status: 'success',
      transactionHash: TX_HASH,
      transactionLink: 'https://arbiscan.io/tx/x',
    })
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting on a bridge while its source is pending with a hash but no substatus', async () => {
    // Only WAIT_DESTINATION_TRANSACTION says that the source landed.
    vi.useFakeTimers()
    statusAnswers(
      { status: 'PENDING', sending: { txHash: TX_HASH } },
      {
        status: 'PENDING',
        substatus: 'WAIT_DESTINATION_TRANSACTION',
        sending: { txHash: TX_HASH },
      }
    )

    const outcome = track(runBridge())
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(outcome).toEqual({ settled: true })
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  describe('a bridge transfer that FAILED with a source hash', () => {
    const sourceReceipt = (
      getTransactionReceipt: () => Promise<unknown>
    ): ReturnType<typeof vi.fn> => {
      const receipt = vi.fn(getTransactionReceipt)
      vi.mocked(getPublicClient).mockResolvedValue({
        getTransactionReceipt: receipt,
      } as never)
      return receipt
    }

    beforeEach(() => {
      vi.mocked(getPublicClient).mockReset()
      vi.mocked(getStatus).mockResolvedValue({
        status: 'FAILED',
        substatus: 'UNKNOWN_FAILED_ERROR',
        sending: { txHash: TX_HASH, txLink: 'https://arbiscan.io/tx/x' },
      } as never)
    })

    it('resolves with the source hash when the source transaction landed', async () => {
      // The user's tokens left the wallet. A final failure would let a resume
      // sign and relay a second transfer; the status task follows this one.
      const receipt = sourceReceipt(async () => ({ status: 'success' }))

      await expect(runBridge()).resolves.toMatchObject({
        status: 'success',
        transactionHash: TX_HASH,
      })
      expect(getPublicClient).toHaveBeenCalledWith(expect.anything(), 42161)
      expect(receipt).toHaveBeenCalledWith({ hash: TX_HASH })
    })

    it('marks it as final when the source transaction reverted: it moved nothing', async () => {
      sourceReceipt(async () => ({ status: 'reverted' }))

      await expect(runBridge()).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionFailed,
        final: true,
      })
    })

    it('checks the source receipt again when the node does not have it yet', async () => {
      vi.useFakeTimers()
      const receipt = vi
        .fn()
        .mockRejectedValueOnce(new Error('receipt not found'))
        .mockResolvedValueOnce({ status: 'success' })
      vi.mocked(getPublicClient).mockResolvedValue({
        getTransactionReceipt: receipt,
      } as never)

      const outcome = track(runBridge())
      await vi.advanceTimersByTimeAsync(0)
      expect(outcome.settled).toBe(false)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(outcome).toEqual({ settled: true })
      expect(getStatus).toHaveBeenCalledTimes(2)
    })

    it('leaves the outcome unknown when the source receipt cannot be loaded five times in a row', async () => {
      // Not final: a resume waits for the same task and checks again instead
      // of signing a second transfer.
      vi.useFakeTimers()
      const receipt = sourceReceipt(async () => {
        throw new Error('receipt not found')
      })

      const outcome = track(runBridge())
      await vi.advanceTimersByTimeAsync(5_000 * 4)

      expect(outcome.settled).toBe(true)
      expect(outcome.error).toMatchObject({
        code: LiFiErrorCode.TransactionFailed,
        final: false,
      })
      expect(getStatus).toHaveBeenCalledTimes(5)
      expect(receipt).toHaveBeenCalledTimes(5)
    })
  })

  it('keeps waiting on one chain while the source is pending with a hash: the swap can still revert', async () => {
    vi.useFakeTimers()
    statusAnswers(
      { status: 'PENDING', sending: { txHash: TX_HASH } },
      { status: 'DONE', sending: { txHash: TX_HASH } }
    )

    const outcome = track(runGasless())
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(outcome).toEqual({ settled: true })
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it('marks FAILED with a source hash as final on one chain: the revert moved nothing', async () => {
    statusAnswers({ status: 'FAILED', sending: { txHash: TX_HASH } })

    await expect(runGasless()).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      final: true,
    })
  })

  it('resolves with sending.txHash on DONE, without a metadata field', async () => {
    statusAnswers({ status: 'DONE', sending: { txHash: TX_HASH } })

    await expect(runGasless()).resolves.toMatchObject({
      status: 'success',
      transactionHash: TX_HASH,
    })
  })

  it('keeps polling through fewer than five status errors in a row', async () => {
    vi.useFakeTimers()
    // `/status` answers 422/1004 for a real task id when its lookup fails, and
    // a network error looks the same to the poll.
    const lookupFailed = Object.assign(new Error('Unprocessable task id'), {
      code: 1004,
    })
    vi.mocked(getStatus)
      .mockRejectedValueOnce(lookupFailed)
      .mockRejectedValueOnce(lookupFailed)
      .mockResolvedValueOnce({ status: 'NOT_FOUND' } as never)
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({
        status: 'DONE',
        sending: { txHash: TX_HASH },
      } as never)

    const outcome = track(runGasless())
    await vi.advanceTimersByTimeAsync(5_000 * 4)

    expect(outcome).toEqual({ settled: true })
    expect(getStatus).toHaveBeenCalledTimes(5)
  })

  it('leaves the status unknown after five status errors in a row', async () => {
    vi.useFakeTimers()
    vi.mocked(getStatus).mockRejectedValue(
      Object.assign(new Error('Unprocessable task id'), { code: 1004 })
    )

    const outcome = track(runGasless())
    await vi.advanceTimersByTimeAsync(5_000 * 4)

    expect(outcome.settled).toBe(true)
    expect(outcome.error).toMatchObject({
      code: LiFiErrorCode.TransactionNotFound,
      final: false,
    })
    expect(getStatus).toHaveBeenCalledTimes(5)
  })

  it('marks FAILED / EXPIRED as final', async () => {
    statusAnswers({ status: 'FAILED', substatus: 'EXPIRED' })

    await expect(runGasless()).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      final: true,
    })
    expect(getStatus).toHaveBeenCalledTimes(1)
  })
})

describe('waitForRelayedTransactionReceipt for a relayed step that is not gasless', () => {
  it('still asks the relayer status with the bridge', async () => {
    vi.mocked(getRelayedTransactionStatus).mockResolvedValue({
      status: 'DONE',
      transactionStatus: { sending: { txHash: `0x${'ef'.repeat(32)}` } },
    } as never)

    await run()

    expect(getRelayedTransactionStatus).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getRelayedTransactionStatus).mock.calls[0][1]).toEqual({
      taskId: TASK_ID,
      fromChain: 1,
      toChain: 1,
      bridge: 'lifi',
    })
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('does not throw a TypeError when the DONE answer has no metadata', async () => {
    vi.mocked(getRelayedTransactionStatus).mockResolvedValue({
      status: 'DONE',
      sending: { txHash: `0x${'ef'.repeat(32)}` },
    } as never)

    await expect(run()).resolves.toMatchObject({ status: 'success' })
  })
})
