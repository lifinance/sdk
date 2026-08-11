import { describe, expect, it, vi } from 'vitest'

vi.mock('../actions/getFundingOrder.js', () => ({
  getFundingOrder: vi.fn(),
}))

import { buildFundingOrder } from '../actions/fundingOrders.unit.mock.js'
import { getFundingOrder } from '../actions/getFundingOrder.js'
import { LiFiErrorCode } from '../errors/constants.js'
import type { LiFiStepExtended } from '../types/core.js'
import {
  getFundingOrderUpdatedStep,
  isFundingOrderStep,
} from './fundingOrderStep.js'

const step = {
  id: 'step-1',
  fundingOrderId: 'order-1',
  execution: { status: 'PENDING', actions: [] },
} as unknown as LiFiStepExtended

describe('isFundingOrderStep', () => {
  it('is true only when fundingOrderId is a non-empty string', () => {
    expect(isFundingOrderStep(step)).toBe(true)
    expect(isFundingOrderStep({ id: 'x' } as LiFiStepExtended)).toBe(false)
  })

  it('returns false for fundingOrderId with an empty string', () => {
    expect(
      isFundingOrderStep({
        id: 'step-1',
        fundingOrderId: '',
      } as LiFiStepExtended)
    ).toBe(false)
  })
})

describe('getFundingOrderUpdatedStep', () => {
  it('restores the committed quote onto the step, keeping id, marker, and execution', async () => {
    const quote = {
      id: 'server-quote-id',
      transactionRequest: { to: '0xTo', data: '0xdata' },
    }
    vi.mocked(getFundingOrder).mockResolvedValue(
      buildFundingOrder({ quote: quote as any })
    )
    const updated = await getFundingOrderUpdatedStep({} as any, step)
    expect(updated.id).toBe('step-1')
    expect(updated.fundingOrderId).toBe('order-1')
    expect(updated.execution).toBe(step.execution)
    expect(updated.transactionRequest).toEqual({ to: '0xTo', data: '0xdata' })
  })

  it('throws TransactionUnprepared when the order quote has no transactionRequest', async () => {
    vi.mocked(getFundingOrder).mockResolvedValue(buildFundingOrder())
    await expect(
      getFundingOrderUpdatedStep({} as any, step)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionUnprepared })
  })

  it('throws ValidationError when the step has no fundingOrderId and does not call getFundingOrder', async () => {
    const stepWithoutFundingOrderId = { id: 'step-1' } as LiFiStepExtended
    vi.mocked(getFundingOrder).mockClear()
    await expect(
      getFundingOrderUpdatedStep({} as any, stepWithoutFundingOrderId)
    ).rejects.toMatchObject({ code: LiFiErrorCode.ValidationError })
    expect(vi.mocked(getFundingOrder)).not.toHaveBeenCalled()
  })
})
