import { HttpResponse, http } from 'msw'
import { buildStepObject } from '../../tests/fixtures.js'
import { config } from '../config.js'
import {
  mockChainsResponse,
  mockStatus,
  mockStepTransactionWithTxRequest,
} from './execution.unit.mock.js'

const apiUrl = config.getApiUrl()

export const lifiHandlers = [
  http.post(`${apiUrl}/advanced/stepTransaction`, async () =>
    HttpResponse.json(
      mockStepTransactionWithTxRequest(
        buildStepObject({
          includingExecution: true,
        })
      )
    )
  ),
  http.get(`${apiUrl}/chains`, async () =>
    HttpResponse.json({
      chains: mockChainsResponse,
    })
  ),
  http.get(`${apiUrl}/status`, async () => HttpResponse.json(mockStatus)),
]
