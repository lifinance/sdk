import type { TransactionAnalyticsRequest } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import * as request from '../request.js'
import { requestSettings } from '../request.js'
import { config, handlers } from './api.unit.handlers.js'
import { getTransactionHistory } from './getTransactionHistory.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getTransactionHistory', () => {
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

  it('returns empty array in response', async () => {
    server.use(
      http.get(`${config.apiUrl}/analytics/transfers`, async () =>
        HttpResponse.json({})
      )
    )

    const walletAnalyticsRequest: TransactionAnalyticsRequest = {
      fromTimestamp: 1696326609361,
      toTimestamp: 1696326609362,
      wallet: '0x5520abcd',
    }

    const generatedURL =
      'https://li.quest/v1/analytics/transfers?integrator=lifi-sdk&wallet=0x5520abcd&fromTimestamp=1696326609361&toTimestamp=1696326609362'

    await expect(
      getTransactionHistory(config, walletAnalyticsRequest)
    ).resolves.toEqual({})

    expect((mockedFetch.mock.calls[0][1] as URL).href).toEqual(generatedURL)
    expect(mockedFetch).toHaveBeenCalledOnce()
  })
})
