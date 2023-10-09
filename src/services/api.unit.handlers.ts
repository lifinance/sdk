import { ChainId, CoinKey } from '@lifi/types'
import { rest } from 'msw'
import { findDefaultToken } from '../../tests/tokens.js'
import { config } from '../config.js'

const _config = config.get()

export const handlers = [
  rest.post(
    `${_config.apiUrl}/advanced/routes`,
    async (request, response, context) => {
      const data = await request.json()
      if (isNaN(parseFloat(data.fromAmount))) {
        return response(context.status(500), context.json({ message: `Oops` }))
      }
      return response(context.json({}))
    }
  ),
  rest.post(
    `${_config.apiUrl}/advanced/possibilities`,
    async (_, response, context) => {
      return response(context.json({}))
    }
  ),
  rest.get(`${_config.apiUrl}/token`, async (_, response, context) => {
    return response(context.json({}))
  }),
  rest.get(`${_config.apiUrl}/quote`, async (_, response, context) => {
    return response(context.json({}))
  }),
  rest.get(`${_config.apiUrl}/status`, async (_, response, context) => {
    return response(context.json({}))
  }),
  rest.get(`${_config.apiUrl}/chains`, async (_, response, context) => {
    return response(context.json({ chains: [{ id: 1 }] }))
  }),
  rest.get(`${_config.apiUrl}/tools`, async (_, response, context) => {
    return response(context.json({ bridges: [], exchanges: [] }))
  }),
  rest.get(`${_config.apiUrl}/tokens`, async (_, response, context) => {
    return response(
      context.json({
        tokens: {
          [ChainId.ETH]: [findDefaultToken(CoinKey.ETH, ChainId.ETH)],
        },
      })
    )
  }),
  rest.post(
    `${_config.apiUrl}/advanced/stepTransaction`,
    async (_, response, context) => {
      return response(context.json({}))
    }
  ),
  rest.get(
    `${_config.apiUrl}/gas/suggestion/${ChainId.OPT}`,
    async (_, response, context) => {
      return response(context.json({}))
    }
  ),
]
