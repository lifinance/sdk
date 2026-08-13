import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { buildFundingOrder } from './fundingOrders.unit.mock.js'
import { getFundingOrder } from './getFundingOrder.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getFundingOrder', () => {
  const server = setupTestServer()

  it('throws a ValidationError when orderId is empty', async () => {
    await expect(getFundingOrder(client, '')).rejects.toThrowError(
      new SDKError(
        new ValidationError('Required parameter "orderId" is missing.')
      )
    )
    expect(mockedFetch).toHaveBeenCalledTimes(0)
  })

  it('fetches the order by id', async () => {
    const order = await getFundingOrder(
      client,
      '3f2a6c1e-0000-4000-8000-000000000001'
    )
    expect(order.status).toBe('PENDING')
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('passes txHash and integrator as query parameters', async () => {
    let requestedUrl = ''
    server.use(
      http.get(
        `${client.config.apiUrl}/funding/orders/:orderId`,
        async ({ request: req }) => {
          requestedUrl = req.url
          return HttpResponse.json(buildFundingOrder())
        }
      )
    )
    await getFundingOrder(client, 'order-1', {
      txHash: '0xabc',
      integrator: 'jumper',
    })
    expect(requestedUrl).toContain('txHash=0xabc')
    expect(requestedUrl).toContain('integrator=jumper')
  })
})
