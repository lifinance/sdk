import type { LiFiStep } from '@lifi/types'
import { describe, expect, it } from 'vitest'
import { buildFundingOrder } from '../actions/fundingOrders.unit.mock.js'
import type { LiFiStepExtended } from '../types/core.js'
import { convertOrderToRoute } from './convertOrderToRoute.js'

const buildQuote = (): LiFiStep =>
  ({
    id: 'quote-step-1',
    type: 'lifi',
    tool: 'relay',
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
      approvalAddress: '0xApproval',
      executionDuration: 30,
    },
    transactionRequest: { to: '0xTo', data: '0xdata' },
    includedSteps: [],
  }) as unknown as LiFiStep

describe('convertOrderToRoute', () => {
  it('wraps the quote in a synthetic route keyed by orderId', () => {
    const order = buildFundingOrder({ quote: buildQuote() })
    const route = convertOrderToRoute(order)
    expect(route.id).toBe(order.orderId)
    expect(route.steps).toHaveLength(1)
    expect((route.steps[0] as LiFiStepExtended).fundingOrderId).toBe(
      order.orderId
    )
    expect(route.steps[0].transactionRequest).toBeDefined()
  })

  it('throws for a non-STANDARD order', () => {
    const order = buildFundingOrder({
      type: 'SMART_DEPOSIT',
      quote: buildQuote(),
    })
    expect(() => convertOrderToRoute(order)).toThrowError(
      /Only STANDARD funding orders/
    )
  })

  it('throws when the order has no quote', () => {
    const order = buildFundingOrder()
    expect(() => convertOrderToRoute(order)).toThrowError(/has no quote/)
  })

  it('sets skipPermit on the produced step', () => {
    const order = buildFundingOrder({ quote: buildQuote() })
    const route = convertOrderToRoute(order)
    expect(route.steps[0].estimate.skipPermit).toBe(true)
  })

  it('strips typedData so a funding step can never route to the relayer', () => {
    // The backend refuses `gasless` on a funding quote today, so this shape is
    // unreachable in production - but nothing in code enforces it, and
    // isRelayerStep / EthereumCheckPermitsTask both key on typedData alone.
    const quote = {
      ...buildQuote(),
      typedData: [
        {
          primaryType: 'Permit',
          domain: { chainId: 1, name: 'USDC', version: '2' },
          types: { Permit: [] },
          message: {},
        },
      ],
    } as unknown as LiFiStep
    const order = buildFundingOrder({ quote })

    const route = convertOrderToRoute(order)

    expect((route.steps[0] as LiFiStepExtended).typedData).toBeUndefined()
    // The strip must not reach back into the caller's order.
    expect(order.quote?.typedData).toHaveLength(1)
  })

  it('leaves the caller order untouched', () => {
    const order = buildFundingOrder({ quote: buildQuote() })
    const before = structuredClone(order)
    const route = convertOrderToRoute(order)
    expect(order).toEqual(before)
    expect(route.steps[0]).not.toBe(order.quote)
  })
})
