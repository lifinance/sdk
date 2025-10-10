import { HttpResponse, http } from 'msw'
import { buildStepObject } from '../../tests/fixtures.js'
import { createConfig } from '../createConfig.js'
import {
  mockChainsResponse,
  mockStatus,
  mockStepTransactionWithTxRequest,
} from './execution.unit.mock.js'

const config = createConfig({ integrator: 'lifi-sdk' })
const _config = config.get()

export const lifiHandlers = [
  http.post(`${_config.apiUrl}/advanced/stepTransaction`, async () =>
    HttpResponse.json(
      mockStepTransactionWithTxRequest(
        buildStepObject({
          includingExecution: true,
        })
      )
    )
  ),
  http.get(`${_config.apiUrl}/chains`, async () =>
    HttpResponse.json({
      chains: mockChainsResponse,
    })
  ),
  http.get(`${_config.apiUrl}/status`, async () =>
    HttpResponse.json(mockStatus)
  ),
]
