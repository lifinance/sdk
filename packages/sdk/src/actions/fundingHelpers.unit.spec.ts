import { describe, expect, it, vi } from 'vitest'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { createCexSession } from './createCexSession.js'
import { createOnrampSession } from './createOnrampSession.js'
import { getOnrampFiatCurrencies } from './getOnrampFiatCurrencies.js'
import { getOnrampQuote } from './getOnrampQuote.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('funding helper actions', () => {
  setupTestServer()

  it('getOnrampQuote posts to /funding/onramp/quote', async () => {
    await getOnrampQuote(client, {
      tokenAddress: '0x0',
      chainId: 1,
      fiatAmount: '100',
      fiatCurrency: 'EUR',
    })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('getOnrampFiatCurrencies posts to /funding/onramp/fiat-currencies', async () => {
    await getOnrampFiatCurrencies(client, { tokenAddress: '0x0', chainId: 1 })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('createOnrampSession posts to /funding/onramp/session', async () => {
    await createOnrampSession(client, {
      depositAddress: '0x1',
      tokenAddress: '0x0',
      chainId: 1,
      fiatAmount: '100',
      fiatCurrency: 'EUR',
    })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('createCexSession posts to /funding/cex/session', async () => {
    await createCexSession(client, {
      walletAddress: '0x2',
      tokenAddress: '0x0',
      chainId: 1,
      userId: 'user-1',
    })
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })
})
