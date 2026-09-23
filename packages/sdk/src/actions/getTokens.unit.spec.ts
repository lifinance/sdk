import { ChainId } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createClient } from '../client/createClient.js'
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
})
