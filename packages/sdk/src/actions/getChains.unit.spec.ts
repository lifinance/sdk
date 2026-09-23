import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../client/createClient.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getChains } from './getChains.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getChains', () => {
  const server = setupTestServer()

  describe('and the backend call is successful', () => {
    it('call the server once', async () => {
      const chains = await getChains(client)

      expect(chains[0]?.id).toEqual(1)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
    })
  })

  // Requests are deduplicated while in flight. Two clients on different API
  // bases can ask the same query at once, and the bases can answer with
  // different chain sets, so each client must get its own response.
  it('keeps concurrent requests to different API bases apart', async () => {
    const baseA = createClient({
      integrator: 'lifi-sdk',
      apiUrl: 'https://base-a.example/v1',
    })
    const baseB = createClient({
      integrator: 'lifi-sdk',
      apiUrl: 'https://base-b.example/v1',
    })
    server.use(
      http.get('https://base-a.example/v1/chains', () =>
        HttpResponse.json({ chains: [{ id: 1 }] })
      ),
      http.get('https://base-b.example/v1/chains', () =>
        HttpResponse.json({ chains: [{ id: 2 }] })
      )
    )

    const [fromA, fromB] = await Promise.all([
      getChains(baseA),
      getChains(baseB),
    ])

    expect(fromA.map((chain) => chain.id)).toEqual([1])
    expect(fromB.map((chain) => chain.id)).toEqual([2])
  })
})
