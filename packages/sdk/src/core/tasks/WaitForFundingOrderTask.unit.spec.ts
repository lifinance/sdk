import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/waitForFundingOrder.js', () => ({
  waitForFundingOrder: vi.fn(),
}))

import { buildFundingOrder } from '../../actions/fundingOrders.unit.mock.js'
import { waitForFundingOrder } from '../../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { SDKError } from '../../errors/SDKError.js'
import type { LiFiStepExtended } from '../../types/core.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { WaitForFundingOrderTask } from './WaitForFundingOrderTask.js'
import { WaitForTransactionStatusTask } from './WaitForTransactionStatusTask.js'

const buildStep = (): LiFiStepExtended =>
  ({
    id: 'step-1',
    fundingOrderId: 'order-1',
    action: { fromChainId: 1, toChainId: 137 },
    execution: { status: 'PENDING', actions: [] },
  }) as unknown as LiFiStepExtended

const buildContext = (
  step: LiFiStepExtended,
  sourceAction: Record<string, unknown> = {
    type: 'SWAP',
    txHash: '0xsource',
  }
): StepExecutorContext =>
  ({
    client: {} as any,
    step,
    statusManager: {
      findAction: vi.fn(() => sourceAction),
      initializeAction: vi.fn(() => ({ type: 'RECEIVING_CHAIN' })),
      updateAction: vi.fn(),
      updateExecution: vi.fn(),
    } as any,
    isBridgeExecution: false,
    toChain: { id: 137, metamask: { blockExplorerUrls: ['https://x/'] } },
  }) as unknown as StepExecutorContext

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WaitForFundingOrderTask', () => {
  it('writes the sentinel substatus before the first poll', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const step = buildStep()
    const context = buildContext(step)

    await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)

    expect(context.statusManager.updateAction).toHaveBeenNthCalledWith(
      1,
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      { substatus: 'WAIT_DESTINATION_TRANSACTION' }
    )
  })

  it('resets a stale substatus to the sentinel on re-entry', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const step = buildStep()
    const context = buildContext(step)
    vi.mocked(context.statusManager.initializeAction).mockReturnValue({
      type: 'RECEIVING_CHAIN',
      substatus: 'INTENT_AWAITING_FUNDS',
    } as any)

    await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)

    expect(context.statusManager.updateAction).toHaveBeenNthCalledWith(
      1,
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      { substatus: 'WAIT_DESTINATION_TRANSACTION' }
    )
  })

  it('forwards the source txHash, integrator and signal into the wait', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const signal = new AbortController().signal
    const context = buildContext(buildStep())
    context.executionOptions = {
      integrator: 'jumper',
      signal,
      pollingInterval: 3_000,
      timeout: 60_000,
    } as any

    await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)

    expect(vi.mocked(waitForFundingOrder)).toHaveBeenCalledWith(
      context.client,
      'order-1',
      expect.objectContaining({
        txHash: '0xsource',
        integrator: 'jumper',
        signal,
        pollingInterval: 10_000,
        timeout: 60_000,
      })
    )
  })

  it('never writes the open-string funding substatus to the action', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE', substatus: 'COMPLETED' })
    )
    const step = buildStep()
    const context = buildContext(step)
    const onOrderUpdate = vi.fn()
    context.executionOptions = { onOrderUpdate } as any

    await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)

    const onUpdate = vi.mocked(waitForFundingOrder).mock.calls[0][2]!.onUpdate!
    vi.mocked(context.statusManager.updateAction).mockClear()

    const pending = buildFundingOrder({
      status: 'PENDING',
      substatus: 'INTENT_AWAITING_FUNDS',
    })
    onUpdate(pending)

    expect(onOrderUpdate).toHaveBeenCalledWith(pending)
    expect(context.statusManager.updateAction).not.toHaveBeenCalled()
  })

  it('keeps the source txHash when a DONE order carries no toTxHash', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({
        status: 'DONE',
        result: { fromTxHash: '0xsource', toAmount: '990000' },
      })
    )
    const step = buildStep()
    const context = buildContext(step)

    await new WaitForFundingOrderTask('SWAP').run(context)

    const terminal = vi
      .mocked(context.statusManager.updateAction)
      .mock.calls.find((call) => call[2] === 'DONE')!
    expect(terminal[3]).toEqual({ chainId: 137 })
    expect(terminal[3]).not.toHaveProperty('txHash')
    expect(terminal[3]).not.toHaveProperty('txLink')
  })

  it('writes txHash and txLink when a DONE order carries toTxHash', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({
        status: 'DONE',
        result: { toTxHash: '0xdest', toAmount: '990000' },
      })
    )
    const step = buildStep()
    const context = buildContext(step)

    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      context
    )

    expect(result.status).toBe('COMPLETED')
    expect(context.statusManager.updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'DONE',
      { chainId: 137, txHash: '0xdest', txLink: 'https://x/tx/0xdest' }
    )
    expect(context.statusManager.updateExecution).toHaveBeenCalledWith(step, {
      status: 'DONE',
      toAmount: '990000',
    })
  })

  it('marks FAILED without throwing so the caller can resolve', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'FAILED', substatus: 'ONRAMP_FAILED' })
    )
    const step = buildStep()
    const context = buildContext(step)

    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      context
    )

    expect(result.status).toBe('COMPLETED')
    expect(context.statusManager.updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'FAILED',
      expect.objectContaining({
        error: expect.objectContaining({
          code: LiFiErrorCode.TransactionFailed,
        }),
      })
    )
  })

  it('returns PAUSED on a timeout and leaves the execution resumable', async () => {
    vi.mocked(waitForFundingOrder).mockRejectedValue(
      new SDKError(
        new TransactionError(LiFiErrorCode.Timeout, 'did not reach terminal')
      )
    )
    const step = buildStep()
    const context = buildContext(step)

    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      context
    )

    expect(result.status).toBe('PAUSED')
    expect(context.statusManager.updateExecution).not.toHaveBeenCalledWith(
      step,
      expect.objectContaining({ status: 'FAILED' })
    )
  })

  it('rethrows a non-timeout failure', async () => {
    vi.mocked(waitForFundingOrder).mockRejectedValue(new Error('network down'))
    await expect(
      new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
        buildContext(buildStep())
      )
    ).rejects.toThrowError(/network down/)
  })

  it('throws a ValidationError for a step without fundingOrderId', async () => {
    const step = { id: 'step-1', action: {} } as unknown as LiFiStepExtended
    const context = buildContext(step)
    await expect(
      new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)
    ).rejects.toMatchObject({ code: LiFiErrorCode.ValidationError })
    expect(vi.mocked(waitForFundingOrder)).not.toHaveBeenCalled()
    expect(context.statusManager.initializeAction).not.toHaveBeenCalled()
  })
})

describe('WaitForTransactionStatusTask — funding delegation', () => {
  it('routes funding steps to WaitForFundingOrderTask', async () => {
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const result = await new WaitForTransactionStatusTask(
      'RECEIVING_CHAIN'
    ).run(buildContext(buildStep()))
    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(waitForFundingOrder)).toHaveBeenCalledTimes(1)
  })
})
