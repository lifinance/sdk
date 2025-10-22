import { HttpResponse, http } from 'msw'
import { buildStepObject } from '../../tests/fixtures.js'
import { createClient } from './client/createClient.js'
import {
  mockChainsResponse,
  mockStatus,
  mockStepTransactionWithTxRequest,
} from './execution.unit.mock.js'

const client = createClient({
  integrator: 'lifi-sdk',
})

export const lifiHandlers = [
  http.post(`${client.config.apiUrl}/advanced/stepTransaction`, async () =>
    HttpResponse.json(
      mockStepTransactionWithTxRequest(
        buildStepObject({
          includingExecution: true,
        })
      )
    )
  ),
  http.get(`${client.config.apiUrl}/chains`, async () =>
    HttpResponse.json({
      chains: mockChainsResponse,
    })
  ),
  http.get(`${client.config.apiUrl}/status`, async () =>
    HttpResponse.json(mockStatus)
  ),
]
