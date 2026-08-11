import type { FundingOrder } from '../types/funding.js'

export const buildFundingOrder = (
  overrides?: Partial<FundingOrder>
): FundingOrder => ({
  orderId: '3f2a6c1e-0000-4000-8000-000000000001',
  partnerOrderId: 'partner-order-1',
  type: 'STANDARD',
  status: 'PENDING',
  destination: {
    toChainId: 137,
    toTokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    toAddress: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
  },
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
  ...overrides,
})
