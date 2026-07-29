import { beforeEach, describe, expect, it, vi } from 'vitest'

const getStepTransaction = vi.fn()
const stepComparison = vi.fn()
vi.mock('@lifi/sdk', async () => {
  const actual = await vi.importActual<typeof import('@lifi/sdk')>('@lifi/sdk')
  return {
    ...actual,
    getStepTransaction: (...args: unknown[]) => getStepTransaction(...args),
    stepComparison: (...args: unknown[]) => stepComparison(...args),
  }
})

const { StellarPrepareTransactionTask } = await import(
  './StellarPrepareTransactionTask.js'
)

const FRESH_ENVELOPE = 'FRESH_ENVELOPE_XDR'
const STALE_ENVELOPE = 'STALE_ENVELOPE_XDR'

const makeContext = (
  step: Record<string, unknown>,
  allowUserInteraction = true
) => {
  const updateAction = vi.fn()
  return {
    updateAction,
    step,
    context: {
      client: {},
      step,
      statusManager: {
        findAction: () => ({ type: 'SWAP' }),
        updateAction,
      },
      allowUserInteraction,
      isBridgeExecution: false,
    } as never,
  }
}

describe('StellarPrepareTransactionTask', () => {
  beforeEach(() => {
    getStepTransaction.mockReset().mockResolvedValue({
      transactionRequest: { data: FRESH_ENVELOPE },
    })
    // stepComparison normally returns the accepted (new) step
    stepComparison
      .mockReset()
      .mockImplementation(async (_sm, _old, updated) => updated)
  })

  // This is the entire reason the task exists as an override of the core
  // PrepareTransactionTask. A Stellar envelope embeds the sender's sequence
  // number and short timebounds, so reusing one is never correct.
  it('re-fetches even when the step ALREADY carries a transactionRequest', async () => {
    const { context, step } = makeContext({
      action: { fromChainId: 1500 },
      transactionRequest: { data: STALE_ENVELOPE },
      execution: { actions: [] },
    })

    await new StellarPrepareTransactionTask().run(context)

    expect(getStepTransaction).toHaveBeenCalledTimes(1)
    expect((step.transactionRequest as { data: string }).data).toBe(
      FRESH_ENVELOPE
    )
  })

  it('re-fetches when the step carries no transactionRequest', async () => {
    const { context, step } = makeContext({
      action: { fromChainId: 1500 },
      execution: { actions: [] },
    })

    await new StellarPrepareTransactionTask().run(context)

    expect(getStepTransaction).toHaveBeenCalledTimes(1)
    expect((step.transactionRequest as { data: string }).data).toBe(
      FRESH_ENVELOPE
    )
  })

  it('strips execution from the step sent to the backend but preserves it locally', async () => {
    const execution = { actions: [{ type: 'SWAP' }] }
    const { context, step } = makeContext({
      action: { fromChainId: 1500 },
      execution,
    })

    await new StellarPrepareTransactionTask().run(context)

    expect(getStepTransaction.mock.calls[0][1]).not.toHaveProperty('execution')
    expect(step.execution).toBe(execution)
  })

  it('marks the action ACTION_REQUIRED and pauses when interaction is disallowed', async () => {
    const { context, updateAction } = makeContext(
      { action: { fromChainId: 1500 }, execution: { actions: [] } },
      false
    )

    const result = await new StellarPrepareTransactionTask().run(context)

    expect(updateAction).toHaveBeenCalledWith(
      expect.anything(),
      'SWAP',
      'ACTION_REQUIRED'
    )
    expect(result).toEqual({ status: 'PAUSED' })
  })

  it('throws when the backend returns no envelope', async () => {
    getStepTransaction.mockResolvedValue({})
    const { context } = makeContext({
      action: { fromChainId: 1500 },
      execution: { actions: [] },
    })

    await expect(
      new StellarPrepareTransactionTask().run(context)
    ).rejects.toThrow(/Transaction request data is not found/)
  })
})
