import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { createCexSession } from './createCexSession.js'
import { createOnrampSession } from './createOnrampSession.js'
import { getOnrampFiatCurrencies } from './getOnrampFiatCurrencies.js'
import { getOnrampQuote } from './getOnrampQuote.js'

describe('funding helper actions', () => {
  const server = setupTestServer()

  it('getOnrampQuote posts to /funding/onramp/quote', async () => {
    let capturedUrl = ''
    let capturedBody: unknown
    const params = {
      tokenAddress: '0x0',
      chainId: 1,
      fiatAmount: '100',
      fiatCurrency: 'EUR',
    }
    server.use(
      http.post(
        `${client.config.apiUrl}/funding/onramp/quote`,
        async ({ request: req }) => {
          capturedUrl = req.url
          capturedBody = await req.json()
          return HttpResponse.json({})
        }
      )
    )
    await getOnrampQuote(client, params)
    expect(capturedUrl).toContain('/funding/onramp/quote')
    expect(capturedBody).toEqual(params)
  })

  it('getOnrampFiatCurrencies posts to /funding/onramp/fiat-currencies', async () => {
    let capturedUrl = ''
    let capturedBody: unknown
    const params = { tokenAddress: '0x0', chainId: 1 }
    server.use(
      http.post(
        `${client.config.apiUrl}/funding/onramp/fiat-currencies`,
        async ({ request: req }) => {
          capturedUrl = req.url
          capturedBody = await req.json()
          return HttpResponse.json({})
        }
      )
    )
    await getOnrampFiatCurrencies(client, params)
    expect(capturedUrl).toContain('/funding/onramp/fiat-currencies')
    expect(capturedBody).toEqual(params)
  })

  it('createOnrampSession posts to /funding/onramp/session', async () => {
    let capturedUrl = ''
    let capturedBody: unknown
    const params = {
      depositAddress: '0x1',
      tokenAddress: '0x0',
      chainId: 1,
      fiatAmount: '100',
      fiatCurrency: 'EUR',
    }
    server.use(
      http.post(
        `${client.config.apiUrl}/funding/onramp/session`,
        async ({ request: req }) => {
          capturedUrl = req.url
          capturedBody = await req.json()
          return HttpResponse.json({})
        }
      )
    )
    await createOnrampSession(client, params)
    expect(capturedUrl).toContain('/funding/onramp/session')
    expect(capturedBody).toEqual(params)
  })

  it('createCexSession posts to /funding/cex/session', async () => {
    let capturedUrl = ''
    let capturedBody: unknown
    const params = {
      walletAddress: '0x2',
      tokenAddress: '0x0',
      chainId: 1,
      userId: 'user-1',
    }
    server.use(
      http.post(
        `${client.config.apiUrl}/funding/cex/session`,
        async ({ request: req }) => {
          capturedUrl = req.url
          capturedBody = await req.json()
          return HttpResponse.json({})
        }
      )
    )
    await createCexSession(client, params)
    expect(capturedUrl).toContain('/funding/cex/session')
    expect(capturedBody).toEqual(params)
  })
})
