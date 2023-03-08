import { ChainId, CoinKey, findDefaultToken } from '@lifi/types'
import { rest } from 'msw'
import ConfigService from './ConfigService'

const config = ConfigService.getInstance().getConfig()

export const handlers = [
  rest.post(
    `${config.apiUrl}/advanced/routes`,
    async (request, response, context) => {
      const data = await request.json()
      if (isNaN(parseFloat(data.fromAmount))) {
        return response(context.status(500), context.json({ message: `Oops` }))
      }
      return response(context.json({}))
    }
  ),
  rest.post(
    `${config.apiUrl}/advanced/possibilities`,
    async (request, response, context) => {
      return response(context.json({}))
    }
  ),
  rest.get(`${config.apiUrl}/token`, async (request, response, context) => {
    return response(context.json({}))
  }),
  rest.get(`${config.apiUrl}/quote`, async (request, response, context) => {
    return response(context.json({}))
  }),
  rest.get(`${config.apiUrl}/status`, async (request, response, context) => {
    return response(context.json({}))
  }),
  rest.get(`${config.apiUrl}/chains`, async (request, response, context) => {
    return response(context.json({ chains: [{ id: 1 }] }))
  }),
  rest.get(`${config.apiUrl}/tools`, async (request, response, context) => {
    return response(context.json({ bridges: [], exchanges: [] }))
  }),
  rest.get(`${config.apiUrl}/tokens`, async (request, response, context) => {
    return response(
      context.json({
        tokens: {
          [ChainId.ETH]: [findDefaultToken(CoinKey.ETH, ChainId.ETH)],
        },
      })
    )
  }),
  rest.post(
    `${config.apiUrl}/advanced/stepTransaction`,
    async (request, response, context) => {
      return response(context.json({}))
    }
  ),
  rest.get(
    `${config.apiUrl}/gas/suggestion/${ChainId.OPT}`,
    async (request, response, context) => {
      return response(context.json({}))
    }
  ),
]
