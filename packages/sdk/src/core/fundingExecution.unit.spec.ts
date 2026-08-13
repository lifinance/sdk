import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./execution.js', () => ({
  executeRoute: vi.fn(),
  resumeRoute: vi.fn(),
  getActiveRoute: vi.fn(),
}))
vi.mock('../actions/getFundingOrder.js', () => ({
  getFundingOrder: vi.fn(),
}))
vi.mock('../actions/waitForFundingOrder.js', () => ({
  waitForFundingOrder: vi.fn(),
}))

import { buildFundingOrder } from '../actions/fundingOrders.unit.mock.js'
import { getFundingOrder } from '../actions/getFundingOrder.js'
import { waitForFundingOrder } from '../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { executeRoute, getActiveRoute, resumeRoute } from './execution.js'
import { executeFundingOrder, resumeFundingOrder } from './fundingExecution.js'

/** The id every buildFundingOrder() order carries. */
const orderId = buildFundingOrder().orderId

const quote = {
  id: 'quote-1',
  action: {
    fromChainId: 1,
    fromAmount: '1000000',
    fromToken: { chainId: 1, address: '0x0', decimals: 6, priceUSD: '1' },
    fromAddress: '0xSender',
    toChainId: 137,
    toToken: { chainId: 137, address: '0x1', decimals: 6, priceUSD: '1' },
    toAddress: '0xReceiver',
  },
  estimate: {
    fromAmountUSD: '1.00',
    toAmount: '990000',
    toAmountMin: '980000',
    toAmountUSD: '0.99',
    approvalAddress: '0xA',
    executionDuration: 30,
  },
  transactionRequest: { to: '0xTo', data: '0xdata' },
  includedSteps: [],
} as any

/** Resolves executeRoute/resumeRoute after firing the given transitions. */
const fireTransitions = (...orders: ReturnType<typeof buildFundingOrder>[]) =>
  vi.fn(async (_client: unknown, _route: unknown, options?: any) => {
    for (const order of orders) {
      options?.onOrderUpdate?.(order)
    }
    return {} as any
  })

/** Resolves executeRoute/resumeRoute after firing one terminal transition. */
const fireTerminal = (order: ReturnType<typeof buildFundingOrder>) =>
  fireTransitions(order)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getActiveRoute).mockReturnValue(undefined)
})

describe('executeFundingOrder', () => {
  it('rejects a FAILED input order', async () => {
    await expect(
      executeFundingOrder({} as any, buildFundingOrder({ status: 'FAILED' }))
    ).rejects.toThrowError(/new order/)
  })

  it('returns a DONE order as-is without executing', async () => {
    const done = buildFundingOrder({ status: 'DONE' })
    await expect(executeFundingOrder({} as any, done)).resolves.toBe(done)
    expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
  })

  it('resolves with the captured terminal order and makes no extra read', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    vi.mocked(executeRoute).mockImplementation(fireTerminal(terminal))
    const final = await executeFundingOrder(
      {} as any,
      buildFundingOrder({ quote })
    )
    expect(final).toBe(terminal)
    expect(vi.mocked(getFundingOrder)).not.toHaveBeenCalled()
  })

  it('resolves with a FAILED terminal order rather than throwing', async () => {
    const terminal = buildFundingOrder({ status: 'FAILED' })
    vi.mocked(executeRoute).mockImplementation(fireTerminal(terminal))
    const final = await executeFundingOrder(
      {} as any,
      buildFundingOrder({ quote })
    )
    expect(final.status).toBe('FAILED')
  })

  it('rejects with Timeout when the order never reaches a terminal state', async () => {
    vi.mocked(executeRoute).mockResolvedValue({} as any)
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    await expect(
      executeFundingOrder({} as any, buildFundingOrder({ quote }))
    ).rejects.toMatchObject({ code: LiFiErrorCode.Timeout })
  })

  it('falls back to one read when no transition fired', async () => {
    vi.mocked(executeRoute).mockResolvedValue({} as any)
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await executeFundingOrder(
      {} as any,
      buildFundingOrder({ quote })
    )
    expect(final.status).toBe('DONE')
    expect(vi.mocked(getFundingOrder)).toHaveBeenCalledTimes(1)
  })

  it('still forwards the caller onOrderUpdate callback', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    vi.mocked(executeRoute).mockImplementation(fireTerminal(terminal))
    const onOrderUpdate = vi.fn()
    await executeFundingOrder({} as any, buildFundingOrder({ quote }), {
      onOrderUpdate,
    })
    expect(onOrderUpdate).toHaveBeenCalledWith(terminal)
  })

  it('forwards every transition and resolves with the last one', async () => {
    const pending = buildFundingOrder({
      substatus: 'WAIT_SOURCE_CONFIRMATIONS',
    })
    const terminal = buildFundingOrder({ status: 'DONE' })
    vi.mocked(executeRoute).mockImplementation(
      fireTransitions(pending, terminal)
    )
    const onOrderUpdate = vi.fn()
    const final = await executeFundingOrder(
      {} as any,
      buildFundingOrder({ quote }),
      { onOrderUpdate }
    )
    expect(onOrderUpdate).toHaveBeenNthCalledWith(1, pending)
    expect(onOrderUpdate).toHaveBeenNthCalledWith(2, terminal)
    expect(final).toBe(terminal)
    expect(vi.mocked(getFundingOrder)).not.toHaveBeenCalled()
  })

  it('reports the fallback order through onOrderUpdate', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    vi.mocked(executeRoute).mockResolvedValue({} as any)
    vi.mocked(getFundingOrder).mockResolvedValue(terminal)
    const onOrderUpdate = vi.fn()
    const final = await executeFundingOrder(
      {} as any,
      buildFundingOrder({ quote }),
      { onOrderUpdate }
    )
    expect(final).toBe(terminal)
    expect(onOrderUpdate).toHaveBeenCalledTimes(1)
    expect(onOrderUpdate).toHaveBeenCalledWith(terminal)
  })

  it.each(['SMART_DEPOSIT', 'ONRAMP'] as const)(
    'only polls for %s orders',
    async (type) => {
      vi.mocked(waitForFundingOrder).mockResolvedValue(
        buildFundingOrder({ status: 'DONE' })
      )
      const final = await executeFundingOrder(
        {} as any,
        buildFundingOrder({ type })
      )
      expect(final.status).toBe('DONE')
      expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
    }
  )
})

describe('resumeFundingOrder', () => {
  it('returns immediately when the refreshed order is terminal', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(final.status).toBe('DONE')
    expect(vi.mocked(resumeRoute)).not.toHaveBeenCalled()
  })

  /**
   * The mock deliberately simplifies: it fires onOrderUpdate, which the real
   * layer 2 never does - resumeRoute attaches to the running execution and
   * forwards only executeInBackground, so the already-polling wait task keeps
   * the first call's callback. This test pins one thing only: the live route
   * object is what gets resumed. The test below exercises the real shape.
   */
  it('resumes the live route when one is still in memory', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    const live = { id: orderId, steps: [] } as any
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder({ quote }))
    vi.mocked(getActiveRoute).mockReturnValue(live)
    vi.mocked(resumeRoute).mockImplementation(fireTerminal(terminal))

    const final = await resumeFundingOrder({} as any, buildFundingOrder())

    expect(vi.mocked(resumeRoute).mock.calls[0][1]).toBe(live)
    expect(final.status).toBe('DONE')
  })

  it('decides the live-route resume by the fallback read and reports it', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    const live = { id: orderId, steps: [] } as any
    vi.mocked(getFundingOrder)
      .mockResolvedValueOnce(buildFundingOrder({ quote }))
      .mockResolvedValueOnce(terminal)
    vi.mocked(getActiveRoute).mockReturnValue(live)
    // No transition: the running wait task never sees the wrapped callback.
    vi.mocked(resumeRoute).mockResolvedValue({} as any)
    const onOrderUpdate = vi.fn()

    const final = await resumeFundingOrder({} as any, buildFundingOrder(), {
      onOrderUpdate,
    })

    expect(vi.mocked(resumeRoute).mock.calls[0][1]).toBe(live)
    expect(final).toBe(terminal)
    expect(onOrderUpdate).toHaveBeenCalledWith(terminal)
  })

  it('polls only when the order already reports a source transaction', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ quote, result: { fromTxHash: '0xsent' } })
    )
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(final.status).toBe('DONE')
    expect(vi.mocked(resumeRoute)).not.toHaveBeenCalled()
    expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
  })

  it('polls only when the caller supplies sourceTxHash, and reports it', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder({ quote }))
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await resumeFundingOrder({} as any, buildFundingOrder(), {
      sourceTxHash: '0xbroadcast',
    })
    expect(final.status).toBe('DONE')
    expect(vi.mocked(resumeRoute)).not.toHaveBeenCalled()
    expect(vi.mocked(waitForFundingOrder)).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({ txHash: '0xbroadcast' })
    )
  })

  it('treats an empty fromTxHash as no source transaction', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ quote, result: { fromTxHash: '' } })
    )
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await resumeFundingOrder({} as any, buildFundingOrder(), {
      sourceTxHash: '0xbroadcast',
    })
    expect(final.status).toBe('DONE')
    expect(vi.mocked(resumeRoute)).not.toHaveBeenCalled()
    expect(vi.mocked(waitForFundingOrder)).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({ txHash: '0xbroadcast' })
    )
  })

  it('never reports txHash on a non-STANDARD resume', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({
        type: 'SMART_DEPOSIT',
        result: { fromTxHash: '0xsent' },
      })
    )
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    await resumeFundingOrder({} as any, buildFundingOrder(), {
      sourceTxHash: '0xbroadcast',
    })
    expect(
      vi.mocked(waitForFundingOrder).mock.calls[0][2]?.txHash
    ).toBeUndefined()
  })

  it('forwards integrator and signal to the poll', async () => {
    const signal = new AbortController().signal
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ quote, result: { fromTxHash: '0xsent' } })
    )
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    await resumeFundingOrder({} as any, buildFundingOrder(), {
      integrator: 'jumper',
      signal,
    })
    expect(vi.mocked(waitForFundingOrder)).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({ integrator: 'jumper', signal })
    )
  })

  it('rebuilds and resumes only when nothing was sent yet', async () => {
    const terminal = buildFundingOrder({ status: 'DONE' })
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder({ quote }))
    vi.mocked(resumeRoute).mockImplementation(fireTerminal(terminal))
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(vi.mocked(resumeRoute)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(resumeRoute).mock.calls[0][1].id).toBe(orderId)
    expect(final.status).toBe('DONE')
  })

  it('scopes the refresh with integrator', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    await resumeFundingOrder({} as any, buildFundingOrder(), {
      integrator: 'jumper',
    })
    expect(vi.mocked(getFundingOrder)).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      { integrator: 'jumper' }
    )
  })
})
