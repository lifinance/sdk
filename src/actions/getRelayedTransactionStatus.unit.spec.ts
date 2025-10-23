import type {
  RelayStatusRequest,
  RelayStatusResponse,
  RelayStatusResponseData,
  RequestOptions,
} from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { config, setupTestServer } from './actions.unit.handlers.js'
import { getRelayedTransactionStatus } from './getRelayedTransactionStatus.js'

describe('getRelayedTransactionStatus', () => {
  const server = setupTestServer()

  const createMockRelayStatusRequest = (
    overrides: Partial<RelayStatusRequest> = {}
  ): RelayStatusRequest => ({
    taskId:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    ...overrides,
  })

  const mockStatusResponseData: RelayStatusResponseData = {
    status: 'PENDING',
    metadata: {
      chainId: 1,
    },
  }

  const mockSuccessResponse: RelayStatusResponse = {
    status: 'ok',
    data: mockStatusResponseData,
  }

  const mockErrorResponse: RelayStatusResponse = {
    status: 'error',
    data: {
      code: 404,
      message: 'Task not found',
    },
  }

  describe('success scenarios', () => {
    it('should get relayed transaction status successfully', async () => {
      server.use(
        http.get(
          `${config.apiUrl}/relayer/status/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`,
          async () => {
            return HttpResponse.json(mockSuccessResponse)
          }
        )
      )

      const request = createMockRelayStatusRequest()

      const result = await getRelayedTransactionStatus(config, request)

      expect(result).toEqual(mockStatusResponseData)
    })

    it('should pass request options correctly', async () => {
      const mockAbortController = new AbortController()
      const options: RequestOptions = {
        signal: mockAbortController.signal,
      }

      let capturedOptions: any
      server.use(
        http.get(
          `${config.apiUrl}/relayer/status/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`,
          async ({ request }) => {
            capturedOptions = request
            return HttpResponse.json(mockSuccessResponse)
          }
        )
      )

      const request = createMockRelayStatusRequest()

      await getRelayedTransactionStatus(config, request, options)

      expect(capturedOptions.signal).toBeDefined()
      expect(capturedOptions.signal).toBeInstanceOf(AbortSignal)
    })

    it('should handle different task statuses', async () => {
      const pendingResponse = {
        ...mockSuccessResponse,
        data: { ...mockStatusResponseData, status: 'PENDING' },
      }
      const completedResponse = {
        ...mockSuccessResponse,
        data: { ...mockStatusResponseData, status: 'COMPLETED' },
      }
      const failedResponse = {
        ...mockSuccessResponse,
        data: { ...mockStatusResponseData, status: 'FAILED' },
      }

      // Test PENDING status
      server.use(
        http.get(
          `${config.apiUrl}/relayer/status/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`,
          async () => {
            return HttpResponse.json(pendingResponse)
          }
        )
      )

      let result = await getRelayedTransactionStatus(
        config,
        createMockRelayStatusRequest()
      )
      expect(result.status).toBe('PENDING')

      // Test COMPLETED status
      server.resetHandlers()
      server.use(
        http.get(
          `${config.apiUrl}/relayer/status/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`,
          async () => {
            return HttpResponse.json(completedResponse)
          }
        )
      )

      result = await getRelayedTransactionStatus(
        config,
        createMockRelayStatusRequest()
      )
      expect(result.status).toBe('COMPLETED')

      // Test FAILED status
      server.resetHandlers()
      server.use(
        http.get(
          `${config.apiUrl}/relayer/status/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`,
          async () => {
            return HttpResponse.json(failedResponse)
          }
        )
      )

      result = await getRelayedTransactionStatus(
        config,
        createMockRelayStatusRequest()
      )
      expect(result.status).toBe('FAILED')
    })
  })

  describe('validation scenarios', () => {
    it('should throw SDKError when taskId is missing', async () => {
      const invalidRequest = createMockRelayStatusRequest({
        taskId: undefined as any,
      })

      await expect(
        getRelayedTransactionStatus(config, invalidRequest)
      ).rejects.toThrow(SDKError)

      try {
        await getRelayedTransactionStatus(config, invalidRequest)
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError)
        expect((error as SDKError).cause).toBeInstanceOf(ValidationError)
        expect((error as SDKError).cause.message).toBe(
          'Required parameter "taskId" is missing.'
        )
      }
    })
  })

  describe('error scenarios', () => {
    it('should throw BaseError when server returns error status', async () => {
      server.use(
        http.get(
          `${config.apiUrl}/relayer/status/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`,
          async () => {
            return HttpResponse.json(mockErrorResponse)
          }
        )
      )

      const request = createMockRelayStatusRequest()

      await expect(
        getRelayedTransactionStatus(config, request)
      ).rejects.toThrow(BaseError)

      try {
        await getRelayedTransactionStatus(config, request)
      } catch (error) {
        expect(error).toBeInstanceOf(BaseError)
        expect((error as BaseError).name).toBe(ErrorName.ServerError)
        expect((error as BaseError).code).toBe(404)
        expect((error as BaseError).message).toBe('Task not found')
      }
    })

    it('should throw SDKError when network request fails', async () => {
      server.use(
        http.get(
          `${config.apiUrl}/relayer/status/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`,
          async () => {
            return HttpResponse.error()
          }
        )
      )

      const request = createMockRelayStatusRequest()

      await expect(
        getRelayedTransactionStatus(config, request)
      ).rejects.toThrow(SDKError)
    })

    it('should throw SDKError when request times out', async () => {
      server.use(
        http.get(
          `${config.apiUrl}/relayer/status/0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`,
          async () => {
            // Simulate timeout by not responding
            await new Promise(() => {}) // Never resolves
          }
        )
      )

      const request = createMockRelayStatusRequest()
      const timeoutOptions: RequestOptions = {
        signal: AbortSignal.timeout(100), // 100ms timeout
      }

      await expect(
        getRelayedTransactionStatus(config, request, timeoutOptions)
      ).rejects.toThrow()
    })
  })
})
