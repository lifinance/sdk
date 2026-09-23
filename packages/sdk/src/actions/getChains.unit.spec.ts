import { delay, HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../client/createClient.js'
import { SDKError } from '../errors/SDKError.js'
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

  // A signal belongs to the caller that passed it. Callers that share an
  // in-flight request must not fail because another one aborted.
  it('lets a caller finish when another caller of the same request aborts', async () => {
    const base = createClient({
      integrator: 'lifi-sdk',
      apiUrl: 'https://abort.example/v1',
    })
    server.use(
      http.get('https://abort.example/v1/chains', async () => {
        await delay(50)
        return HttpResponse.json({ chains: [{ id: 1 }] })
      })
    )
    const leaving = new AbortController()

    const left = getChains(base, undefined, { signal: leaving.signal })
    const stayed = getChains(base, undefined, {
      signal: new AbortController().signal,
    })
    leaving.abort()

    const error = await left.catch((error: unknown) => error)
    expect(error).toBeInstanceOf(SDKError)
    expect((error as SDKError).cause).toBe(leaving.signal.reason)
    await expect(stayed).resolves.toEqual([{ id: 1 }])
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('aborts the request once every caller has left', async () => {
    const base = createClient({
      integrator: 'lifi-sdk',
      apiUrl: 'https://abort-all.example/v1',
    })
    let requestAborted = false
    server.use(
      http.get('https://abort-all.example/v1/chains', async ({ request }) => {
        request.signal.addEventListener('abort', () => {
          requestAborted = true
        })
        await delay(50)
        return HttpResponse.json({ chains: [] })
      })
    )
    const leaving = new AbortController()

    const left = getChains(base, undefined, { signal: leaving.signal })
    await delay(10)
    leaving.abort()

    await expect(left).rejects.toBeInstanceOf(SDKError)
    await vi.waitFor(() => expect(requestAborted).toBe(true))
  })
})
