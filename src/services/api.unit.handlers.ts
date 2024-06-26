import { ChainId, CoinKey } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { findDefaultToken } from '../../tests/tokens.js'
import { config } from '../config.js'

const _config = config.get()

export const handlers = [
  http.post(`${_config.apiUrl}/advanced/routes`, async () => {
    return HttpResponse.json({})
  }),
  http.post(`${_config.apiUrl}/advanced/possibilities`, async () =>
    HttpResponse.json({})
  ),
  http.get(`${_config.apiUrl}/token`, async () => HttpResponse.json({})),
  http.get(`${_config.apiUrl}/quote`, async () => HttpResponse.json({})),
  http.get(`${_config.apiUrl}/status`, async () => HttpResponse.json({})),
  http.get(`${_config.apiUrl}/chains`, async () =>
    HttpResponse.json({ chains: [{ id: 1 }] })
  ),
  http.get(`${_config.apiUrl}/tools`, async () =>
    HttpResponse.json({ bridges: [], exchanges: [] })
  ),
  http.get(`${_config.apiUrl}/tokens`, async () =>
    HttpResponse.json({
      tokens: {
        [ChainId.ETH]: [findDefaultToken(CoinKey.ETH, ChainId.ETH)],
      },
    })
  ),
  http.post(`${_config.apiUrl}/advanced/stepTransaction`, async () =>
    HttpResponse.json({})
  ),
  http.get(`${_config.apiUrl}/gas/suggestion/${ChainId.OPT}`, async () =>
    HttpResponse.json({})
  ),
]
