import { findDefaultToken } from '@lifi/data-types'
import { ChainId, CoinKey } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { LiFiErrorCode } from '../errors/constants.js'
import { SDKError } from '../errors/SDKError.js'
import type { RoutesRequest } from '../types/actions.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getRouteAvailability } from './getRouteAvailability.js'

describe('getRouteAvailability', () => {
  const server = setupTestServer()
  const url = `${client.config.apiUrl}/advanced/routes`

  const requestFor = (fromAmount: string): RoutesRequest => ({
    fromChainId: ChainId.ETH,
    fromAmount,
    fromTokenAddress: findDefaultToken(CoinKey.ETH, ChainId.ETH).address,
    toChainId: ChainId.BAS,
    toTokenAddress: findDefaultToken(CoinKey.ETH, ChainId.BAS).address,
  })

  it('classifies a response that contains routes as ROUTABLE', async () => {
    server.use(
      http.post(url, () =>
        HttpResponse.json({
          routes: [{ id: 'route-1' }],
          unavailableRoutes: { filteredOut: [], failed: [] },
        })
      )
    )

    const result = await getRouteAvailability(client, requestFor('1000'))

    expect(result.status).toBe('ROUTABLE')
    if (result.status !== 'ROUTABLE') {
      throw new Error('unreachable')
    }
    expect(result.response.routes).toHaveLength(1)
  })

  it('classifies a successful empty route list as NO_ROUTE', async () => {
    server.use(
      http.post(url, () =>
        HttpResponse.json({
          routes: [],
          unavailableRoutes: { filteredOut: [], failed: [] },
        })
      )
    )

    const result = await getRouteAvailability(client, requestFor('1000'))

    expect(result.status).toBe('NO_ROUTE')
  })

  it('does not treat a response without a routes list as NO_ROUTE', async () => {
    server.use(http.post(url, () => HttpResponse.json({})))

    const result = await getRouteAvailability(client, requestFor('1000'))

    expect(result.status).toBe('UNKNOWN')
    if (result.status !== 'UNKNOWN') {
      throw new Error('unreachable')
    }
    expect(result.cause).toBeInstanceOf(SDKError)
    expect(result.cause.code).toBe(LiFiErrorCode.InternalError)
  })

  it.each([
    [400, LiFiErrorCode.ValidationError],
    [404, LiFiErrorCode.NotFound],
    [429, LiFiErrorCode.RateLimitExceeded],
    [500, LiFiErrorCode.InternalError],
  ])(
    'keeps an HTTP %s as UNKNOWN instead of NO_ROUTE',
    async (status, code) => {
      server.use(
        http.post(url, () =>
          HttpResponse.json({ message: 'no' }, { status, statusText: 'no' })
        )
      )

      const result = await getRouteAvailability(client, requestFor('1000'))

      expect(result.status).toBe('UNKNOWN')
      if (result.status !== 'UNKNOWN') {
        throw new Error('unreachable')
      }
      expect(result.cause).toBeInstanceOf(SDKError)
      expect(result.cause.code).toBe(code)
    }
  )

  it('keeps an invalid request as UNKNOWN and does not send it', async () => {
    let calls = 0
    server.use(
      http.post(url, () => {
        calls += 1
        return HttpResponse.json({ routes: [] })
      })
    )

    const result = await getRouteAvailability(client, {
      ...requestFor('1000'),
      fromAmount: 1000 as unknown as string,
    })

    expect(calls).toBe(0)
    expect(result.status).toBe('UNKNOWN')
    if (result.status !== 'UNKNOWN') {
      throw new Error('unreachable')
    }
    expect(result.cause.code).toBe(LiFiErrorCode.ValidationError)
  })

  it('keeps an aborted request as UNKNOWN', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await getRouteAvailability(client, requestFor('1000'), {
      signal: controller.signal,
    })

    expect(result.status).toBe('UNKNOWN')
    if (result.status !== 'UNKNOWN') {
      throw new Error('unreachable')
    }
    expect(result.cause).toBeInstanceOf(SDKError)
  })

  it('asks again for a different amount instead of reusing the previous result', async () => {
    const seen: string[] = []
    server.use(
      http.post(url, async ({ request }) => {
        const body = (await request.json()) as { fromAmount: string }
        seen.push(body.fromAmount)
        return HttpResponse.json({
          routes: body.fromAmount === '1' ? [] : [{ id: body.fromAmount }],
          unavailableRoutes: { filteredOut: [], failed: [] },
        })
      })
    )

    const first = await getRouteAvailability(client, requestFor('1'))
    const second = await getRouteAvailability(client, requestFor('2'))

    expect(seen).toEqual(['1', '2'])
    expect(first.status).toBe('NO_ROUTE')
    expect(second.status).toBe('ROUTABLE')
  })
})
