import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { createFundingOrder } from './createFundingOrder.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('createFundingOrder', () => {
  setupTestServer()

  const params = {
    partnerOrderId: 'partner-order-1',
    type: 'STANDARD' as const,
    toChainId: 137,
    toTokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    toAddress: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
  }

  it('throws a ValidationError when partnerOrderId is empty', async () => {
    await expect(
      createFundingOrder(client, { ...params, partnerOrderId: '' })
    ).rejects.toThrowError(
      new SDKError(
        new ValidationError('Required parameter "partnerOrderId" is missing.')
      )
    )
    expect(mockedFetch).toHaveBeenCalledTimes(0)
  })

  it('posts the body and returns the order', async () => {
    const order = await createFundingOrder(client, params)
    expect(order.orderId).toBe('3f2a6c1e-0000-4000-8000-000000000001')
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })
})
