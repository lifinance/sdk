import type { TransactionAnalyticsRequest } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import * as request from '../request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getTransactionHistory } from './getTransactionHistory.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getTransactionHistory', () => {
  const server = setupTestServer()

  it('returns empty array in response', async () => {
    server.use(
      http.get(`${client.config.apiUrl}/analytics/transfers`, async () =>
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
      getTransactionHistory(client, walletAnalyticsRequest)
    ).resolves.toEqual({})

    expect((mockedFetch.mock.calls[0][1] as URL).href).toEqual(generatedURL)
    expect(mockedFetch).toHaveBeenCalledOnce()
  })
})
