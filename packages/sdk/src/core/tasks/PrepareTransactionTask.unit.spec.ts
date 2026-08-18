import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/getStepTransaction.js', () => ({
  getStepTransaction: vi.fn(),
}))
vi.mock('./helpers/stepComparison.js', () => ({
  stepComparison: vi.fn(),
}))

import { getStepTransaction } from '../../actions/getStepTransaction.js'
import type { LiFiStepExtended } from '../../types/core.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { stepComparison } from './helpers/stepComparison.js'
import { PrepareTransactionTask } from './PrepareTransactionTask.js'

const buildContext = (step: LiFiStepExtended): StepExecutorContext =>
  ({
    client: {} as any,
    step,
    statusManager: {
      findAction: vi.fn(() => ({ type: 'SWAP' })),
      updateAction: vi.fn(),
    } as any,
    isBridgeExecution: false,
    allowUserInteraction: true,
  }) as unknown as StepExecutorContext

beforeEach(() => {
  vi.clearAllMocks()
})

/** A provider whose payload can never be reused, as Stellar's cannot. */
class AlwaysRefetchTask extends PrepareTransactionTask {
  protected override shouldRefetchTransaction(): boolean {
    return true
  }
}

describe('PrepareTransactionTask — refetch hook', () => {
  // Locks the contract the Stellar provider relies on. A Stellar envelope
  // embeds the sender's sequence number, so the one a quote carried is already
  // dead by the time the pipeline's own approval has consumed that sequence.
  it('refetches when a subclass forces it, even with a request present', async () => {
    const step = {
      id: 'step-1',
      action: { fromChainId: 1500 },
      transactionRequest: { data: 'STALE_ENVELOPE' },
      execution: { status: 'PENDING', actions: [] },
    } as unknown as LiFiStepExtended
    const updatedStep = {
      id: 'step-1',
      action: { fromChainId: 1500 },
      transactionRequest: { data: 'FRESH_ENVELOPE' },
    } as unknown as LiFiStepExtended
    vi.mocked(getStepTransaction).mockResolvedValue(updatedStep)
    vi.mocked(stepComparison).mockResolvedValue(updatedStep)

    const result = await new AlwaysRefetchTask().run(buildContext(step))

    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(getStepTransaction)).toHaveBeenCalledTimes(1)
    expect(step.transactionRequest).toEqual({ data: 'FRESH_ENVELOPE' })
  })
})
