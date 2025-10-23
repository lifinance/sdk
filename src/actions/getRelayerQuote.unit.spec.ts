import type {
  LiFiStep,
  RelayerQuoteResponse,
  RequestOptions,
} from '@lifi/types'
import { ChainId } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { requestSettings } from '../request.js'
import type { QuoteRequestFromAmount } from '../types/actions.js'
import { config, handlers } from './actions.unit.handlers.js'
import { getRelayerQuote } from './getRelayerQuote.js'

describe('getRelayerQuote', () => {
  const server = setupServer(...handlers)

  beforeAll(() => {
    server.listen({
      onUnhandledRequest: 'warn',
    })
    requestSettings.retries = 0
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => server.resetHandlers())

  afterAll(() => {
    requestSettings.retries = 1
    server.close()
  })

  const createMockQuoteRequest = (
    overrides: Partial<QuoteRequestFromAmount> = {}
  ): QuoteRequestFromAmount => ({
    fromChain: ChainId.ETH,
    fromToken: '0xA0b86a33E6441c8C06DDD4f36e4C4C5B4c3B4c3B',
    fromAddress: '0x1234567890123456789012345678901234567890',
    fromAmount: '1000000',
    toChain: ChainId.POL,
    toToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    ...overrides,
  })

  const mockLiFiStep: LiFiStep = {
    id: 'test-step-id',
    type: 'lifi',
    includedSteps: [],
    tool: 'test-tool',
    toolDetails: {
      key: 'test-tool',
      name: 'Test Tool',
      logoURI: 'https://example.com/logo.png',
    },
    action: {
      fromChainId: ChainId.ETH,
      toChainId: ChainId.POL,
      fromToken: {
        address: '0xA0b86a33E6441c8C06DDD4f36e4C4C5B4c3B4c3B',
        symbol: 'USDC',
        decimals: 6,
        chainId: ChainId.ETH,
        name: 'USD Coin',
        priceUSD: '1.00',
      },
      toToken: {
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        symbol: 'USDC',
        decimals: 6,
        chainId: ChainId.POL,
        name: 'USD Coin',
        priceUSD: '1.00',
      },
      fromAmount: '1000000',
      fromAddress: '0x1234567890123456789012345678901234567890',
      toAddress: '0x1234567890123456789012345678901234567890',
    },
    estimate: {
      fromAmount: '1000000',
      toAmount: '1000000',
      toAmountMin: '970000',
      approvalAddress: '0x1234567890123456789012345678901234567890',
      tool: 'test-tool',
      executionDuration: 30000,
    },
    transactionRequest: {
      to: '0x1234567890123456789012345678901234567890',
      data: '0x',
      value: '0',
      gasLimit: '100000',
    },
  }

  const mockSuccessResponse: RelayerQuoteResponse = {
    status: 'ok',
    data: mockLiFiStep,
  }

  const mockErrorResponse: RelayerQuoteResponse = {
    status: 'error',
    data: {
      code: 400,
      message: 'Invalid request parameters',
    },
  }

  describe('success scenarios', () => {
    it('should get relayer quote successfully', async () => {
      server.use(
        http.get(`${config.apiUrl}/relayer/quote`, async () => {
          return HttpResponse.json(mockSuccessResponse)
        })
      )

      const request = createMockQuoteRequest()

      const result = await getRelayerQuote(config, request)

      expect(result).toEqual(mockLiFiStep)
    })

    it('should pass request options correctly', async () => {
      const mockAbortController = new AbortController()
      const options: RequestOptions = {
        signal: mockAbortController.signal,
      }

      let capturedOptions: any
      server.use(
        http.get(`${config.apiUrl}/relayer/quote`, async ({ request }) => {
          capturedOptions = request
          return HttpResponse.json(mockSuccessResponse)
        })
      )

      const request = createMockQuoteRequest()

      await getRelayerQuote(config, request, options)

      expect(capturedOptions.signal).toBeDefined()
      expect(capturedOptions.signal).toBeInstanceOf(AbortSignal)
    })
  })

  describe('validation scenarios', () => {
    it('should throw SDKError when required parameters are missing', async () => {
      const testCases = [
        { param: 'fromChain', value: undefined },
        { param: 'fromToken', value: undefined },
        { param: 'fromAddress', value: undefined },
        { param: 'fromAmount', value: undefined },
        { param: 'toChain', value: undefined },
        { param: 'toToken', value: undefined },
      ]

      for (const testCase of testCases) {
        const invalidRequest = createMockQuoteRequest({
          [testCase.param]: testCase.value,
        })

        await expect(getRelayerQuote(config, invalidRequest)).rejects.toThrow(
          SDKError
        )

        try {
          await getRelayerQuote(config, invalidRequest)
        } catch (error) {
          expect(error).toBeInstanceOf(SDKError)
          expect((error as SDKError).cause).toBeInstanceOf(ValidationError)
          expect((error as SDKError).cause.message).toBe(
            `Required parameter "${testCase.param}" is missing.`
          )
        }
      }
    })
  })

  describe('error scenarios', () => {
    it('should throw BaseError when server returns error status', async () => {
      server.use(
        http.get(`${config.apiUrl}/relayer/quote`, async () => {
          return HttpResponse.json(mockErrorResponse)
        })
      )

      const request = createMockQuoteRequest()

      await expect(getRelayerQuote(config, request)).rejects.toThrow(BaseError)

      try {
        await getRelayerQuote(config, request)
      } catch (error) {
        expect(error).toBeInstanceOf(BaseError)
        expect((error as BaseError).name).toBe(ErrorName.ServerError)
        expect((error as BaseError).code).toBe(400)
        expect((error as BaseError).message).toBe('Invalid request parameters')
      }
    })

    it('should throw SDKError when network request fails', async () => {
      server.use(
        http.get(`${config.apiUrl}/relayer/quote`, async () => {
          return HttpResponse.error()
        })
      )

      const request = createMockQuoteRequest()

      await expect(getRelayerQuote(config, request)).rejects.toThrow(SDKError)
    })

    it('should throw SDKError when request times out', async () => {
      server.use(
        http.get(`${config.apiUrl}/relayer/quote`, async () => {
          // Simulate timeout by not responding
          await new Promise(() => {}) // Never resolves
        })
      )

      const request = createMockQuoteRequest()
      const timeoutOptions: RequestOptions = {
        signal: AbortSignal.timeout(100), // 100ms timeout
      }

      await expect(
        getRelayerQuote(config, request, timeoutOptions)
      ).rejects.toThrow()
    })
  })
})
