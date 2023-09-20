import { config } from 'config.js'
import { rest } from 'msw'
import { buildStepObject } from '../../tests/fixtures.js'
import {
  mockChainsResponse,
  mockStatus,
  mockStepTransactionWithTxRequest,
} from './execution.unit.mock.js'

const _config = config.get()

export const lifiHandlers = [
  rest.post(
    `${_config.apiUrl}/advanced/stepTransaction`,
    async (_, response, context) =>
      response(
        context.status(200),
        context.json(
          mockStepTransactionWithTxRequest(
            buildStepObject({
              includingExecution: true,
            })
          )
        )
      )
  ),
  rest.get(`${_config.apiUrl}/chains`, async (_, response, context) =>
    response(
      context.status(200),
      context.json({
        chains: mockChainsResponse,
      })
    )
  ),
  rest.get(`${_config.apiUrl}/status`, async (_, response, context) =>
    response(context.status(200), context.json(mockStatus))
  ),
]
