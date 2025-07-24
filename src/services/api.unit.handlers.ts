import { findDefaultToken } from '@lifi/data-types'
import { ChainId, CoinKey } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { config } from '../config.js'

const apiUrl = config.getApiUrl()

export const handlers = [
  http.post(`${apiUrl}/advanced/routes`, async () => {
    return HttpResponse.json({})
  }),
  http.post(`${apiUrl}/advanced/possibilities`, async () =>
    HttpResponse.json({})
  ),
  http.get(`${apiUrl}/token`, async () => HttpResponse.json({})),
  http.get(`${apiUrl}/quote`, async () => HttpResponse.json({})),
  http.get(`${apiUrl}/status`, async () => HttpResponse.json({})),
  http.get(`${apiUrl}/chains`, async () =>
    HttpResponse.json({ chains: [{ id: 1 }] })
  ),
  http.get(`${apiUrl}/tools`, async () =>
    HttpResponse.json({ bridges: [], exchanges: [] })
  ),
  http.get(`${apiUrl}/tokens`, async () =>
    HttpResponse.json({
      tokens: {
        [ChainId.ETH]: [findDefaultToken(CoinKey.ETH, ChainId.ETH)],
      },
    })
  ),
  http.post(`${apiUrl}/advanced/stepTransaction`, async () =>
    HttpResponse.json({})
  ),
  http.get(`${apiUrl}/gas/suggestion/${ChainId.OPT}`, async () =>
    HttpResponse.json({})
  ),
]
