import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { LiFiErrorCode } from '../errors/constants.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { buildFundingOrder } from './fundingOrders.unit.mock.js'
import { waitForFundingOrder } from './waitForFundingOrder.js'

describe('waitForFundingOrder', () => {
  const server = setupTestServer()

  it('polls until DONE and reports each transition once', async () => {
    let calls = 0
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () => {
        calls++
        if (calls === 1) {
          return HttpResponse.json(buildFundingOrder())
        }
        if (calls === 2) {
          return HttpResponse.json(
            buildFundingOrder({ substatus: 'WAIT_DESTINATION_TRANSACTION' })
          )
        }
        return HttpResponse.json(
          buildFundingOrder({ status: 'DONE', substatus: 'COMPLETED' })
        )
      })
    )
    const transitions: (string | undefined)[] = []
    const order = await waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10,
      onUpdate: (o) => transitions.push(o.substatus),
    })
    expect(order.status).toBe('DONE')
    expect(transitions).toEqual([
      undefined,
      'WAIT_DESTINATION_TRANSACTION',
      'COMPLETED',
    ])
  })

  it('rejects with a Timeout code when the order stays PENDING', async () => {
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () =>
        HttpResponse.json(buildFundingOrder())
      )
    )
    await expect(
      waitForFundingOrder(client, 'order-1', {
        pollingInterval: 10,
        timeout: 35,
      })
    ).rejects.toMatchObject({ code: LiFiErrorCode.Timeout })
  })

  it('keeps polling through transient request failures', async () => {
    let calls = 0
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () => {
        calls++
        if (calls === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 })
        }
        return HttpResponse.json(buildFundingOrder({ status: 'DONE' }))
      })
    )
    const order = await waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10,
    })
    expect(order.status).toBe('DONE')
  })

  it('rejects immediately on a client error instead of retrying', async () => {
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 })
      )
    )
    await expect(
      waitForFundingOrder(client, 'missing-order', { pollingInterval: 10 })
    ).rejects.toMatchObject({ code: LiFiErrorCode.NotFound })
  })
})
