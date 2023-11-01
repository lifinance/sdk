import { HttpResponse, http } from 'msw'
import { buildStepObject } from '../../test/fixtures'
import ConfigService from '../services/ConfigService'
import {
  mockChainsResponse,
  mockStatus,
  mockStepTransactionWithTxRequest,
} from './RouteExecutionManager.unit.mock'

const config = ConfigService.getInstance().getConfig()

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
