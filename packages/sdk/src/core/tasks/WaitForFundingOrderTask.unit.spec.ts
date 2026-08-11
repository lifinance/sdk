import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/getFundingOrder.js', () => ({
  getFundingOrder: vi.fn(),
}))
vi.mock('../../actions/waitForFundingOrder.js', () => ({
  waitForFundingOrder: vi.fn(),
}))

import { buildFundingOrder } from '../../actions/fundingOrders.unit.mock.js'
import { getFundingOrder } from '../../actions/getFundingOrder.js'
import { waitForFundingOrder } from '../../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../../errors/constants.js'
import type { LiFiStepExtended } from '../../types/core.js'
import type { StepExecutorContext } from '../../types/execution.js'
import { WaitForFundingOrderTask } from './WaitForFundingOrderTask.js'
import { WaitForTransactionStatusTask } from './WaitForTransactionStatusTask.js'

const buildStep = (): LiFiStepExtended =>
  ({
    id: 'step-1',
    fundingOrderId: 'order-1',
    action: { fromChainId: 1, toChainId: 137 },
  }) as unknown as LiFiStepExtended

const buildContext = (step: LiFiStepExtended): StepExecutorContext => {
  const action = { type: 'SWAP', txHash: '0xsource' }
  return {
    client: {} as any,
    step,
    statusManager: {
      findAction: vi.fn(() => action),
      initializeAction: vi.fn(() => ({ type: 'RECEIVING_CHAIN' })),
      updateAction: vi.fn(),
      updateExecution: vi.fn(),
    } as any,
    isBridgeExecution: false,
    toChain: { id: 137, metamask: { blockExplorerUrls: ['https://x/'] } },
  } as unknown as StepExecutorContext
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WaitForFundingOrderTask', () => {
  it('reports the txHash, polls to DONE, and marks the execution DONE with the order result', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({
        status: 'DONE',
        substatus: 'COMPLETED',
        result: { toTxHash: '0xdest', toAmount: '990000' },
      })
    )
    const step = buildStep()
    const context = buildContext(step)

    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      context
    )

    expect(result.status).toBe('COMPLETED')
    expect(vi.mocked(getFundingOrder)).toHaveBeenCalledWith(
      context.client,
      'order-1',
      { txHash: '0xsource' }
    )
    expect(context.statusManager.updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'DONE',
      expect.objectContaining({
        txHash: '0xdest',
        chainId: 137,
        substatus: 'COMPLETED',
        txLink: 'https://x/tx/0xdest',
      })
    )
    expect(context.statusManager.updateExecution).toHaveBeenCalledWith(
      step,
      expect.objectContaining({ status: 'DONE', toAmount: '990000' })
    )
  })

  it('forwards a clamped pollingInterval and the timeout from executionOptions', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const step = buildStep()
    const context = buildContext(step)
    context.executionOptions = {
      pollingInterval: 3_000,
      timeout: 60_000,
    } as any

    await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(context)

    expect(vi.mocked(waitForFundingOrder)).toHaveBeenCalledWith(
      context.client,
      'order-1',
      expect.objectContaining({ pollingInterval: 10_000, timeout: 60_000 })
    )
  })

  it('drives the onUpdate closure: writes PENDING substatus and forwards every transition to onOrderUpdate', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({
        status: 'DONE',
        substatus: 'COMPLETED',
        result: { toTxHash: '0xdest', toAmount: '990000' },
      })
    )
    const step = buildStep()
    const context = buildContext(step)
    const onOrderUpdate = vi.fn()
    context.executionOptions = { onOrderUpdate } as any

    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      context
    )
    expect(result.status).toBe('COMPLETED')

    const onUpdate = vi.mocked(waitForFundingOrder).mock.calls[0][2]!.onUpdate!

    const pendingOrder = buildFundingOrder({
      status: 'PENDING',
      substatus: 'WAIT_SOURCE_CONFIRMATIONS',
    })
    onUpdate(pendingOrder)

    expect(context.statusManager.updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      expect.objectContaining({ substatus: 'WAIT_SOURCE_CONFIRMATIONS' })
    )
    expect(onOrderUpdate).toHaveBeenCalledWith(pendingOrder)

    vi.mocked(context.statusManager.updateAction).mockClear()
    onOrderUpdate.mockClear()

    const doneOrder = buildFundingOrder({
      status: 'DONE',
      substatus: 'COMPLETED',
    })
    onUpdate(doneOrder)

    expect(onOrderUpdate).toHaveBeenCalledWith(doneOrder)
    expect(context.statusManager.updateAction).not.toHaveBeenCalled()
  })

  it('throws TransactionFailed when the order ends FAILED', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'FAILED', substatus: 'ONRAMP_FAILED' })
    )
    await expect(
      new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
        buildContext(buildStep())
      )
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: expect.stringContaining('ONRAMP_FAILED'),
    })
  })

  it('still polls when reporting the txHash fails', async () => {
    vi.mocked(getFundingOrder).mockRejectedValue(new Error('report failed'))
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const result = await new WaitForFundingOrderTask('RECEIVING_CHAIN').run(
      buildContext(buildStep())
    )
    expect(result.status).toBe('COMPLETED')
  })
})

describe('WaitForTransactionStatusTask — funding delegation', () => {
  it('routes funding steps to WaitForFundingOrderTask', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
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
