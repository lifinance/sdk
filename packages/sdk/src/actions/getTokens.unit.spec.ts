import { ChainId } from '@lifi/types'
import { delay, HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createClient } from '../client/createClient.js'
import { SDKError } from '../errors/SDKError.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getTokens } from './getTokens.js'

describe('getTokens', () => {
  const server = setupTestServer()

  it('return the tokens', async () => {
    const result = await getTokens(client, {
      chains: [ChainId.ETH, ChainId.POL],
    })
    expect(result).toBeDefined()
    expect(result.tokens[ChainId.ETH]).toBeDefined()
  })

  // Requests are deduplicated while in flight. Two clients on different API
  // bases can ask the same query at once, and the bases can answer with
  // different token sets, so each client must get its own response.
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
      http.get('https://base-a.example/v1/tokens', () =>
        HttpResponse.json({ tokens: { [ChainId.ETH]: [{ symbol: 'A' }] } })
      ),
      http.get('https://base-b.example/v1/tokens', () =>
        HttpResponse.json({ tokens: { [ChainId.ETH]: [{ symbol: 'B' }] } })
      )
    )

    const [fromA, fromB] = await Promise.all([
      getTokens(baseA, { chains: [ChainId.ETH] }),
      getTokens(baseB, { chains: [ChainId.ETH] }),
    ])

    expect(fromA.tokens[ChainId.ETH]?.[0]?.symbol).toBe('A')
    expect(fromB.tokens[ChainId.ETH]?.[0]?.symbol).toBe('B')
  })

  // A signal belongs to the caller that passed it. Callers that share an
  // in-flight request must not fail because another one aborted.
  it('lets a caller finish when another caller of the same request aborts', async () => {
    const base = createClient({
      integrator: 'lifi-sdk',
      apiUrl: 'https://abort.example/v1',
    })
    let requests = 0
    server.use(
      http.get('https://abort.example/v1/tokens', async () => {
        requests++
        await delay(50)
        return HttpResponse.json({
          tokens: { [ChainId.ETH]: [{ symbol: 'ETH' }] },
        })
      })
    )
    const leaving = new AbortController()

    const left = getTokens(
      base,
      { chains: [ChainId.ETH] },
      { signal: leaving.signal }
    )
    const stayed = getTokens(
      base,
      { chains: [ChainId.ETH] },
      { signal: new AbortController().signal }
    )
    leaving.abort()

    await expect(left).rejects.toBeInstanceOf(SDKError)
    await expect(stayed).resolves.toMatchObject({
      tokens: { [ChainId.ETH]: [{ symbol: 'ETH' }] },
    })
    expect(requests).toBe(1)
  })

  // Older runtimes and polyfills can abort a signal without a `reason`.
  it('rejects with an SDKError when an abort has no reason', async () => {
    const controller = new AbortController()
    controller.abort()
    Object.defineProperty(controller.signal, 'reason', { value: undefined })

    await expect(
      getTokens(
        client,
        { chains: [ChainId.ETH] },
        { signal: controller.signal }
      )
    ).rejects.toBeInstanceOf(SDKError)
  })
})
