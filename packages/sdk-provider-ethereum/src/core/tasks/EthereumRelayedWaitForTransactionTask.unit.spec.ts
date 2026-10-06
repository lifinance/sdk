import {
  LiFiErrorCode,
  type LiFiStepExtended,
  type StatusManager,
  TransactionError,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/waitForRelayedTransactionReceipt.js', () => ({
  waitForRelayedTransactionReceipt: vi.fn(),
}))

import { waitForRelayedTransactionReceipt } from '../../actions/waitForRelayedTransactionReceipt.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumRelayedWaitForTransactionTask } from './EthereumRelayedWaitForTransactionTask.js'

// The task pauses only when `stopRouteExecution` ended the wait: the
// execution's signal aborted and the wait rejected with an abort error. Every
// other error reaches the step executor, which writes FAILED.

const TASK_ID: Hash = `0x${'ab'.repeat(32)}`

/** The abort reason of a signal that aborted without a reason. */
const abortReasonOf = (controller: AbortController): unknown => {
  controller.abort()
  return controller.signal.reason
}

const buildContext = (
  signal?: AbortSignal
): {
  context: EthereumStepExecutorContext
  statusManager: StatusManager
} => {
  const statusManager = {
    findAction: vi.fn(() => ({
      type: 'SWAP',
      status: 'PENDING',
      taskId: TASK_ID,
    })),
    updateAction: vi.fn(),
    updateExecution: vi.fn(),
  } as unknown as StatusManager
  const context = {
    client: {},
    step: {
      id: 'relayed-step',
      action: { fromChainId: 137, toChainId: 137 },
    } as unknown as LiFiStepExtended,
    statusManager,
    fromChain: { id: 137 },
    isBridgeExecution: false,
    signal,
  } as unknown as EthereumStepExecutorContext
  return { context, statusManager }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EthereumRelayedWaitForTransactionTask: the end of the wait', () => {
  it('returns PAUSED with no write when the stop aborted the wait', async () => {
    const stop = new AbortController()
    const { context, statusManager } = buildContext(stop.signal)
    vi.mocked(waitForRelayedTransactionReceipt).mockRejectedValue(
      abortReasonOf(stop)
    )

    await expect(
      new EthereumRelayedWaitForTransactionTask().run(context)
    ).resolves.toEqual({ status: 'PAUSED' })

    expect(waitForRelayedTransactionReceipt).toHaveBeenCalledWith(
      context.client,
      TASK_ID,
      context.step,
      undefined,
      stop.signal
    )
    expect(statusManager.updateAction).not.toHaveBeenCalled()
    expect(statusManager.updateExecution).not.toHaveBeenCalled()
  })

  it('rethrows an abort error while the signal of the execution is live', async () => {
    // An abort that the stop did not cause, e.g. of a request layer.
    const error = abortReasonOf(new AbortController())
    const { context } = buildContext(new AbortController().signal)
    vi.mocked(waitForRelayedTransactionReceipt).mockRejectedValue(error)

    await expect(
      new EthereumRelayedWaitForTransactionTask().run(context)
    ).rejects.toBe(error)
  })

  it('rethrows an abort error when the execution has no signal', async () => {
    const error = abortReasonOf(new AbortController())
    const { context } = buildContext()
    vi.mocked(waitForRelayedTransactionReceipt).mockRejectedValue(error)

    await expect(
      new EthereumRelayedWaitForTransactionTask().run(context)
    ).rejects.toBe(error)
  })

  it('rethrows a TransactionError that arrives after the stop', async () => {
    const stop = new AbortController()
    stop.abort()
    const error = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Relayed transaction timed out waiting for a result.'
    )
    const { context } = buildContext(stop.signal)
    vi.mocked(waitForRelayedTransactionReceipt).mockRejectedValue(error)

    await expect(
      new EthereumRelayedWaitForTransactionTask().run(context)
    ).rejects.toBe(error)
  })
})
