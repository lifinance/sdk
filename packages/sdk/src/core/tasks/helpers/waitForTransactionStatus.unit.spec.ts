import type { LiFiStep, StatusResponse } from '@lifi/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../actions/getStatus.js', () => ({
  getStatus: vi.fn(),
}))

import { getStatus } from '../../../actions/getStatus.js'
import type { StatusManager } from '../../../core/StatusManager.js'
import type { SDKClient } from '../../../types/core.js'
import {
  TRANSACTION_HASH_OBSERVERS,
  waitForTransactionStatus,
} from './waitForTransactionStatus.js'

const BRIDGE_LINK = 'https://across.example/tx/0xabc'
const LIFI_LINK = 'https://scan.li.fi/tx/0xabc'

const step = {
  id: 'step-1',
  tool: 'across',
  action: {
    fromChainId: 1,
    fromAddress: '0xowner',
    toChainId: 137,
  },
} as unknown as LiFiStep

const pending = (
  links: { bridgeExplorerLink?: string; lifiExplorerLink?: string } = {}
): StatusResponse =>
  ({
    status: 'PENDING',
    substatus: 'WAIT_DESTINATION_TRANSACTION',
    substatusMessage: 'Bridging',
    sending: { txHash: '0xabc', chainId: 1 },
    receiving: { chainId: 137 },
    ...links,
  }) as unknown as StatusResponse

const done = (): StatusResponse =>
  ({
    status: 'DONE',
    substatus: 'COMPLETED',
    sending: { txHash: '0xabc', chainId: 1 },
    receiving: { txHash: '0xdef', chainId: 137 },
  }) as unknown as StatusResponse

/** Each case needs its own hash: the module memoises in-flight polls by hash. */
let hashCounter = 0
const nextHash = (): string => `0xhash${hashCounter++}`

const run = async (
  responses: StatusResponse[]
): Promise<ReturnType<typeof vi.fn>> => {
  const updateAction = vi.fn()
  const statusManager = { updateAction } as unknown as StatusManager
  for (const response of responses) {
    vi.mocked(getStatus).mockResolvedValueOnce(response)
  }
  await waitForTransactionStatus(
    {} as SDKClient,
    statusManager,
    nextHash(),
    step,
    'RECEIVING_CHAIN',
    1
  )
  return updateAction
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('waitForTransactionStatus', () => {
  it('links a pending bridge to its own explorer when the tool has one', async () => {
    const updateAction = await run([
      pending({ bridgeExplorerLink: BRIDGE_LINK, lifiExplorerLink: LIFI_LINK }),
      done(),
    ])

    expect(updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      expect.objectContaining({ txLink: BRIDGE_LINK })
    )
  })

  it('falls back to the LI.FI explorer, which every recorded transfer has', async () => {
    const updateAction = await run([
      pending({ lifiExplorerLink: LIFI_LINK }),
      done(),
    ])

    expect(updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      expect.objectContaining({ txLink: LIFI_LINK })
    )
  })

  it('leaves the link undefined when the status carries neither', async () => {
    const updateAction = await run([pending(), done()])

    expect(updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      expect.objectContaining({ txLink: undefined })
    )
  })

  it('sends the step fields and the hash in the status request', async () => {
    const txHash = nextHash()
    vi.mocked(getStatus).mockResolvedValueOnce(done())

    await waitForTransactionStatus(
      {} as SDKClient,
      { updateAction: vi.fn() } as unknown as StatusManager,
      txHash,
      step,
      'RECEIVING_CHAIN',
      1
    )

    expect(getStatus).toHaveBeenCalledWith(
      {},
      {
        fromChain: 1,
        fromAddress: '0xowner',
        toChain: 137,
        txHash,
        bridge: 'across',
      },
      { signal: expect.any(AbortSignal) }
    )
    expect(vi.mocked(getStatus).mock.calls[0][1]).not.toHaveProperty(
      'transactionId'
    )
  })

  it('still reports the substatus alongside the link', async () => {
    const updateAction = await run([
      pending({ lifiExplorerLink: LIFI_LINK }),
      done(),
    ])

    expect(updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      expect.objectContaining({
        substatus: 'WAIT_DESTINATION_TRANSACTION',
        substatusMessage: 'Bridging',
      })
    )
  })
})

describe('waitForTransactionStatus with abort signals', () => {
  const INTERVAL = 5_000
  const notFound = { status: 'NOT_FOUND' } as unknown as StatusResponse

  type Outcome = { settled: boolean; value?: StatusResponse; error?: unknown }

  const observe = (promise: Promise<StatusResponse>): Outcome => {
    const outcome: Outcome = { settled: false }
    promise.then(
      (value) => {
        outcome.settled = true
        outcome.value = value
      },
      (error: unknown) => {
        outcome.settled = true
        outcome.error = error
      }
    )
    return outcome
  }

  const wait = (txHash: string, signal?: AbortSignal): Outcome =>
    observe(
      waitForTransactionStatus(
        {} as SDKClient,
        { updateAction: vi.fn() } as unknown as StatusManager,
        txHash,
        step,
        'RECEIVING_CHAIN',
        INTERVAL,
        signal
      )
    )

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(getStatus).mockResolvedValue(notFound)
  })

  afterEach(() => {
    vi.mocked(getStatus).mockReset()
    vi.useRealTimers()
  })

  it('lets a caller leave at its abort while another caller keeps the poll', async () => {
    const txHash = nextHash()
    const leaving = new AbortController()
    const left = wait(txHash, leaving.signal)
    const staying = wait(txHash, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(INTERVAL)

    leaving.abort()
    await vi.advanceTimersByTimeAsync(3 * INTERVAL)

    expect(left).toMatchObject({
      settled: true,
      error: expect.objectContaining({ name: 'AbortError' }),
    })
    expect(staying.settled).toBe(false)
    expect(getStatus).toHaveBeenCalledTimes(5)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeDefined()

    vi.mocked(getStatus).mockResolvedValue(done())
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(staying).toMatchObject({
      settled: true,
      value: expect.objectContaining({ status: 'DONE' }),
    })
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeUndefined()
  })

  it('ends the poll and drops its entry when the last caller leaves', async () => {
    const txHash = nextHash()
    const first = new AbortController()
    const second = new AbortController()
    const firstWait = wait(txHash, first.signal)
    const secondWait = wait(txHash, second.signal)
    await vi.advanceTimersByTimeAsync(INTERVAL)

    first.abort()
    second.abort()
    const atLeave = vi.mocked(getStatus).mock.calls.length
    await vi.advanceTimersByTimeAsync(3_600_000)

    expect(firstWait.settled && secondWait.settled).toBe(true)
    expect(vi.mocked(getStatus).mock.calls.length).toBe(atLeave)
    expect(vi.getTimerCount()).toBe(0)
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeUndefined()
  })

  it('aborts the request in flight when the last caller leaves', async () => {
    const txHash = nextHash()
    const leaving = new AbortController()
    vi.mocked(getStatus).mockReturnValue(new Promise(() => {}))
    wait(txHash, leaving.signal)

    leaving.abort()

    const requestSignal = vi.mocked(getStatus).mock.calls[0][2]?.signal
    expect(requestSignal?.aborted).toBe(true)
  })

  it('keeps the poll for a caller without a signal after the others left', async () => {
    const txHash = nextHash()
    const leaving = new AbortController()
    const left = wait(txHash, leaving.signal)
    const pinned = wait(txHash)

    leaving.abort()
    await vi.advanceTimersByTimeAsync(3 * INTERVAL)

    expect(left.settled).toBe(true)
    expect(pinned.settled).toBe(false)
    expect(getStatus).toHaveBeenCalledTimes(4)

    vi.mocked(getStatus).mockResolvedValue(done())
    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(pinned.value).toMatchObject({ status: 'DONE' })
  })

  it('rejects a caller whose signal has already aborted, without a request', async () => {
    const txHash = nextHash()
    const stopped = new AbortController()
    stopped.abort()

    const outcome = wait(txHash, stopped.signal)
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome).toMatchObject({
      settled: true,
      error: expect.objectContaining({ name: 'AbortError' }),
    })
    expect(getStatus).not.toHaveBeenCalled()
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBeUndefined()
  })

  it('keeps the entry of a new poll when the poll it replaced ends', async () => {
    const txHash = nextHash()
    const leaving = new AbortController()
    wait(txHash, leaving.signal)
    leaving.abort()
    // Starts a new poll before the ended one settles.
    wait(txHash)
    const newPoll = TRANSACTION_HASH_OBSERVERS[txHash]

    await vi.advanceTimersByTimeAsync(0)
    expect(newPoll).toBeDefined()
    expect(TRANSACTION_HASH_OBSERVERS[txHash]).toBe(newPoll)

    // A later caller joins the new poll: no second request in the interval.
    wait(txHash)
    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })
})
