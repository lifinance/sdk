import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./execution.js', () => ({
  executeRoute: vi.fn(),
  resumeRoute: vi.fn(),
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
import { executeRoute, resumeRoute } from './execution.js'
import { executeFundingOrder, resumeFundingOrder } from './fundingExecution.js'

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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('executeFundingOrder', () => {
  it('rejects a FAILED order', async () => {
    await expect(
      executeFundingOrder({} as any, buildFundingOrder({ status: 'FAILED' }))
    ).rejects.toThrowError(/new order/)
  })

  it('returns a DONE order as-is without executing', async () => {
    const done = buildFundingOrder({ status: 'DONE' })
    await expect(executeFundingOrder({} as any, done)).resolves.toBe(done)
    expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
  })

  it('executes a STANDARD order through executeRoute and returns the final order', async () => {
    const order = buildFundingOrder({ quote })
    vi.mocked(executeRoute).mockResolvedValue({} as any)
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await executeFundingOrder({} as any, order)
    expect(vi.mocked(executeRoute)).toHaveBeenCalledTimes(1)
    const [, route] = vi.mocked(executeRoute).mock.calls[0]
    expect(route.id).toBe(order.orderId)
    expect(final.status).toBe('DONE')
  })

  it('only polls for SMART_DEPOSIT orders', async () => {
    const order = buildFundingOrder({ type: 'SMART_DEPOSIT' })
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await executeFundingOrder({} as any, order)
    expect(final.status).toBe('DONE')
    expect(vi.mocked(executeRoute)).not.toHaveBeenCalled()
  })
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

  it('skips the pipeline and polls when the source transaction was already sent', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ quote, result: { fromTxHash: '0xsent' } })
    )
    vi.mocked(waitForFundingOrder).mockResolvedValue(
      buildFundingOrder({ status: 'DONE' })
    )
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(final.status).toBe('DONE')
    expect(vi.mocked(resumeRoute)).not.toHaveBeenCalled()
  })

  it('resumes the route pipeline when nothing was sent yet', async () => {
    vi.mocked(getFundingOrder)
      .mockResolvedValueOnce(buildFundingOrder({ quote }))
      .mockResolvedValueOnce(buildFundingOrder({ status: 'DONE' }))
    vi.mocked(resumeRoute).mockResolvedValue({} as any)
    const final = await resumeFundingOrder({} as any, buildFundingOrder())
    expect(vi.mocked(resumeRoute)).toHaveBeenCalledTimes(1)
    expect(final.status).toBe('DONE')
  })
})
