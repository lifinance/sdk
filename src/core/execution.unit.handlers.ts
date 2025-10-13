import { HttpResponse, http } from 'msw'
import { buildStepObject } from '../../tests/fixtures.js'
import { setupTestEnvironment } from '../../tests/setup.js'
import {
  mockChainsResponse,
  mockStatus,
  mockStepTransactionWithTxRequest,
} from './execution.unit.mock.js'

const config = await setupTestEnvironment()

export const lifiHandlers = [
  http.post(`${config.apiUrl}/advanced/stepTransaction`, async () =>
    HttpResponse.json(
      mockStepTransactionWithTxRequest(
        buildStepObject({
          includingExecution: true,
        })
      )
    )
  ),
  http.get(`${config.apiUrl}/chains`, async () =>
    HttpResponse.json({
      chains: mockChainsResponse,
    })
  ),
  http.get(`${config.apiUrl}/status`, async () =>
    HttpResponse.json(mockStatus)
  ),
]
