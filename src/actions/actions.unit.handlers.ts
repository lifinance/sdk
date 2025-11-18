import { findDefaultToken } from '@lifi/data-types'
import { ChainId, CoinKey } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { createClient } from '../client/createClient.js'
import { requestSettings } from '../request.js'

const client = createClient({
  integrator: 'lifi-sdk',
})

export const handlers = [
  http.post(`${client.config.apiUrl}/advanced/routes`, async () => {
    return HttpResponse.json({})
  }),
  http.post(`${client.config.apiUrl}/advanced/possibilities`, async () =>
    HttpResponse.json({})
  ),
  http.get(`${client.config.apiUrl}/token`, async () => HttpResponse.json({})),
  http.get(`${client.config.apiUrl}/quote`, async () => HttpResponse.json({})),
  http.get(`${client.config.apiUrl}/status`, async () => HttpResponse.json({})),
  http.get(`${client.config.apiUrl}/chains`, async () =>
    HttpResponse.json({ chains: [{ id: 1 }] })
  ),
  http.get(`${client.config.apiUrl}/tools`, async () =>
    HttpResponse.json({ bridges: [], exchanges: [] })
  ),
  http.get(`${client.config.apiUrl}/tokens`, async () =>
    HttpResponse.json({
      tokens: {
        [ChainId.ETH]: [findDefaultToken(CoinKey.ETH, ChainId.ETH)],
      },
    })
  ),
  http.post(`${client.config.apiUrl}/advanced/stepTransaction`, async () =>
    HttpResponse.json({})
  ),
  http.get(`${client.config.apiUrl}/gas/suggestion/${ChainId.OPT}`, async () =>
    HttpResponse.json({})
  ),
  http.get(`${client.config.apiUrl}/connections`, async () =>
    HttpResponse.json({ connections: [] })
  ),
  http.get(`${client.config.apiUrl}/analytics/transfers`, async () =>
    HttpResponse.json({})
  ),
]

/**
 * Sets up MSW server with common handlers for HTTP-based tests
 * Call this function at the top level of your test file
 */
export const setupTestServer = () => {
  const server = setupServer(...handlers)

  beforeAll(() => {
    server.listen({
      onUnhandledRequest: 'warn',
    })
    requestSettings.retries = 0
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => server.resetHandlers())

  afterAll(() => {
    requestSettings.retries = 1
    server.close()
  })

  return server
}

export { client }
