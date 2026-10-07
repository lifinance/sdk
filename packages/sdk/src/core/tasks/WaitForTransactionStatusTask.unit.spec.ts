import type { LiFiStep } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./helpers/waitForTransactionStatus.js', () => ({
  waitForTransactionStatus: vi.fn(),
}))

import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { StepExecutorContext } from '../../types/execution.js'
import type { StatusManager } from '../StatusManager.js'
import { waitForTransactionStatus } from './helpers/waitForTransactionStatus.js'
import { WaitForTransactionStatusTask } from './WaitForTransactionStatusTask.js'

// The task pauses only when `stopRouteExecution` ended the wait: the
// execution's signal aborted and the wait rejected with an abort error. Every
// other error becomes a TransactionError, which the step executor writes as
// FAILED.

const TX_HASH = `0x${'cd'.repeat(32)}`

const chain = {
  id: 137,
  name: 'Polygon',
  metamask: { blockExplorerUrls: ['https://polygonscan.com/'] },
}

/** The abort reason of a signal that aborted without a reason. */
const abortReasonOf = (controller: AbortController): unknown => {
  controller.abort()
  return controller.signal.reason
}

const buildContext = (
  signal?: AbortSignal
): { context: StepExecutorContext; statusManager: StatusManager } => {
  const statusManager = {
    findAction: vi.fn(() => ({
      type: 'SWAP',
      status: 'PENDING',
      txHash: TX_HASH,
    })),
    initializeAction: vi.fn(() => ({ type: 'RECEIVING_CHAIN' })),
    updateAction: vi.fn(),
    updateExecution: vi.fn(),
  } as unknown as StatusManager
  const context = {
    client: { getChainById: async () => chain },
    step: {
      id: 'step-1',
      action: {
        fromChainId: 137,
        toChainId: 137,
        toToken: { symbol: 'USDT' },
      },
    } as unknown as LiFiStep,
    statusManager,
    fromChain: chain,
    toChain: chain,
    isBridgeExecution: false,
    allowUserInteraction: true,
    pollingIntervalMs: 5_000,
    signal,
  } as unknown as StepExecutorContext
  return { context, statusManager }
}

/** Runs the task and returns what it rejects with. */
const runRejected = async (context: StepExecutorContext): Promise<unknown> => {
  try {
    await new WaitForTransactionStatusTask('RECEIVING_CHAIN').run(context)
  } catch (error) {
    return error
  }
  throw new Error('The task did not reject.')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WaitForTransactionStatusTask: the end of the wait', () => {
  it('returns PAUSED with no write when the stop aborted the wait', async () => {
    const stop = new AbortController()
    const { context, statusManager } = buildContext(stop.signal)
    vi.mocked(waitForTransactionStatus).mockRejectedValue(abortReasonOf(stop))

    await expect(
      new WaitForTransactionStatusTask('RECEIVING_CHAIN').run(context)
    ).resolves.toEqual({ status: 'PAUSED' })

    expect(waitForTransactionStatus).toHaveBeenCalledWith(
      context.client,
      statusManager,
      TX_HASH,
      context.step,
      'RECEIVING_CHAIN',
      5_000,
      stop.signal
    )
    expect(statusManager.updateAction).not.toHaveBeenCalled()
    expect(statusManager.updateExecution).not.toHaveBeenCalled()
  })

  it('fails with the abort error as the cause while the signal of the execution is live', async () => {
    // An abort that the stop did not cause, e.g. of a request layer.
    const error = abortReasonOf(new AbortController())
    const { context } = buildContext(new AbortController().signal)
    vi.mocked(waitForTransactionStatus).mockRejectedValue(error)

    const rejected = await runRejected(context)

    expect(rejected).toBeInstanceOf(TransactionError)
    expect(rejected).toMatchObject({ code: LiFiErrorCode.TransactionFailed })
    expect((rejected as TransactionError).cause).toBe(error)
  })

  it('fails with the abort error as the cause when the execution has no signal', async () => {
    const error = abortReasonOf(new AbortController())
    const { context } = buildContext()
    vi.mocked(waitForTransactionStatus).mockRejectedValue(error)

    const rejected = await runRejected(context)

    expect(rejected).toBeInstanceOf(TransactionError)
    expect((rejected as TransactionError).cause).toBe(error)
  })

  it('fails on an error other than an abort that arrives after the stop', async () => {
    const stop = new AbortController()
    stop.abort()
    const error = new Error(
      "Status doesn't contain destination chain information."
    )
    const { context } = buildContext(stop.signal)
    vi.mocked(waitForTransactionStatus).mockRejectedValue(error)

    const rejected = await runRejected(context)

    expect(rejected).toBeInstanceOf(TransactionError)
    expect((rejected as TransactionError).cause).toBe(error)
  })
})
