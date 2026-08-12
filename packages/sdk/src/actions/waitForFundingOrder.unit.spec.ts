import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { LiFiErrorCode } from '../errors/constants.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { buildFundingOrder } from './fundingOrders.unit.mock.js'
import { waitForFundingOrder } from './waitForFundingOrder.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('waitForFundingOrder', () => {
  const server = setupTestServer()

  it('rejects with a ValidationError when orderId is empty, without polling', async () => {
    await expect(
      waitForFundingOrder(client, '', { pollingInterval: 10 })
    ).rejects.toMatchObject({ code: LiFiErrorCode.ValidationError })
    expect(mockedFetch).toHaveBeenCalledTimes(0)
  })

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

  it('re-reports txHash on every poll until the order acknowledges it', async () => {
    const seen: (string | null)[] = []
    let calls = 0
    server.use(
      http.get(
        `${client.config.apiUrl}/funding/orders/:orderId`,
        async ({ request: req }) => {
          calls++
          seen.push(new URL(req.url).searchParams.get('txHash'))
          if (calls < 3) {
            return HttpResponse.json(buildFundingOrder())
          }
          if (calls === 3) {
            return HttpResponse.json(
              buildFundingOrder({ result: { fromTxHash: '0xsource' } })
            )
          }
          return HttpResponse.json(buildFundingOrder({ status: 'DONE' }))
        }
      )
    )
    const order = await waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10,
      txHash: '0xsource',
    })
    expect(order.status).toBe('DONE')
    expect(seen.slice(0, 3)).toEqual(['0xsource', '0xsource', '0xsource'])
    expect(seen[3]).toBeNull()
  })

  it('forwards integrator on every poll', async () => {
    const seen: (string | null)[] = []
    let calls = 0
    server.use(
      http.get(
        `${client.config.apiUrl}/funding/orders/:orderId`,
        async ({ request: req }) => {
          calls++
          seen.push(new URL(req.url).searchParams.get('integrator'))
          return HttpResponse.json(
            buildFundingOrder(calls < 2 ? {} : { status: 'DONE' })
          )
        }
      )
    )
    await waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10,
      integrator: 'jumper',
    })
    expect(seen).toEqual(['jumper', 'jumper'])
  })

  it('rejects and stops polling when the signal aborts', async () => {
    let calls = 0
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () => {
        calls++
        return HttpResponse.json(buildFundingOrder())
      })
    )
    const controller = new AbortController()
    const pending = waitForFundingOrder(client, 'order-1', {
      pollingInterval: 10_000,
      signal: controller.signal,
    })
    // Let the first poll land, then abort during the sleep.
    await vi.waitFor(() => expect(calls).toBe(1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })

  it('rejects before the first request when the signal is already aborted', async () => {
    const before = mockedFetch.mock.calls.length
    await expect(
      waitForFundingOrder(client, 'order-1', {
        pollingInterval: 10,
        signal: AbortSignal.abort(),
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockedFetch.mock.calls.length).toBe(before)
  })

  it('rejects with the same abort shape when the signal aborts mid-request', async () => {
    const controller = new AbortController()
    server.use(
      http.get(`${client.config.apiUrl}/funding/orders/:orderId`, async () => {
        controller.abort()
        await new Promise((resolve) => setTimeout(resolve, 50))
        return HttpResponse.json(buildFundingOrder())
      })
    )
    await expect(
      waitForFundingOrder(client, 'order-1', {
        pollingInterval: 10,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
