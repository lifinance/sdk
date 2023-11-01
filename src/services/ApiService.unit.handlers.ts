import { ChainId, CoinKey, findDefaultToken } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import ConfigService from './ConfigService'

const config = ConfigService.getInstance().getConfig()

export const handlers = [
  http.post(`${config.apiUrl}/advanced/routes`, async ({ request }) => {
    const data = (await request.json()) as any
    if (isNaN(parseFloat(data?.fromAmount))) {
      return HttpResponse.json({ message: 'Oops' }, { status: 500 })
    }
    return HttpResponse.json({})
  }),
  http.post(`${config.apiUrl}/advanced/possibilities`, async () =>
    HttpResponse.json({})
  ),
  http.get(`${config.apiUrl}/token`, async () => HttpResponse.json({})),
  http.get(`${config.apiUrl}/quote`, async () => HttpResponse.json({})),
  http.get(`${config.apiUrl}/status`, async () => HttpResponse.json({})),
  http.get(`${config.apiUrl}/chains`, async () =>
    HttpResponse.json({ chains: [{ id: 1 }] })
  ),
  http.get(`${config.apiUrl}/tools`, async () =>
    HttpResponse.json({ bridges: [], exchanges: [] })
  ),
  http.get(`${config.apiUrl}/tokens`, async () =>
    HttpResponse.json({
      tokens: {
        [ChainId.ETH]: [findDefaultToken(CoinKey.ETH, ChainId.ETH)],
      },
    })
  ),
  http.post(`${config.apiUrl}/advanced/stepTransaction`, async () =>
    HttpResponse.json({})
  ),
  http.get(`${config.apiUrl}/gas/suggestion/${ChainId.OPT}`, async () =>
    HttpResponse.json({})
  ),
]
