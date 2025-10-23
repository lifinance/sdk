import type {
  ContractCallsQuoteRequest,
  LiFiStep,
  RequestOptions,
} from '@lifi/types'
import { ChainId } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { config, setupTestServer } from './actions.unit.handlers.js'
import { getContractCallsQuote } from './getContractCallsQuote.js'

describe('getContractCallsQuote', () => {
  const server = setupTestServer()

  const createMockContractCallsRequest = (
    overrides: Partial<ContractCallsQuoteRequest> = {}
  ): ContractCallsQuoteRequest => ({
    fromChain: ChainId.ETH,
    fromToken: '0xA0b86a33E6441c8C06DDD4f36e4C4C5B4c3B4c3B',
    fromAddress: '0x1234567890123456789012345678901234567890',
    toChain: ChainId.POL,
    toToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    contractCalls: [
      {
        fromAmount: '1000000',
        fromTokenAddress: '0xA0b86a33E6441c8C06DDD4f36e4C4C5B4c3B4c3B',
        toContractAddress: '0x1234567890123456789012345678901234567890',
        toContractCallData: '0x1234567890abcdef',
        toContractGasLimit: '100000',
      },
    ],
    fromAmount: '1000000',
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

  describe('success scenarios', () => {
    it('should get contract calls quote successfully with fromAmount', async () => {
      server.use(
        http.post(`${config.apiUrl}/quote/contractCalls`, async () => {
          return HttpResponse.json(mockLiFiStep)
        })
      )

      const request = createMockContractCallsRequest({
        fromAmount: '1000000',
      })

      const result = await getContractCallsQuote(config, request)

      expect(result).toEqual(mockLiFiStep)
    })

    it('should get contract calls quote successfully with toAmount', async () => {
      server.use(
        http.post(`${config.apiUrl}/quote/contractCalls`, async () => {
          return HttpResponse.json(mockLiFiStep)
        })
      )

      const request = createMockContractCallsRequest({
        toAmount: '1000000',
        fromAmount: undefined,
      })

      const result = await getContractCallsQuote(config, request)

      expect(result).toEqual(mockLiFiStep)
    })

    it('should pass request options correctly', async () => {
      const mockAbortController = new AbortController()
      const options: RequestOptions = {
        signal: mockAbortController.signal,
      }

      let capturedOptions: any
      server.use(
        http.post(
          `${config.apiUrl}/quote/contractCalls`,
          async ({ request }) => {
            capturedOptions = request
            return HttpResponse.json(mockLiFiStep)
          }
        )
      )

      const request = createMockContractCallsRequest()

      await getContractCallsQuote(config, request, options)

      expect(capturedOptions.signal).toBeDefined()
      expect(capturedOptions.signal).toBeInstanceOf(AbortSignal)
    })
  })

  describe('validation scenarios', () => {
    it('should throw SDKError when fromChain is missing', async () => {
      const invalidRequest = createMockContractCallsRequest({
        fromChain: undefined as any,
      })

      await expect(
        getContractCallsQuote(config, invalidRequest)
      ).rejects.toThrow(SDKError)

      try {
        await getContractCallsQuote(config, invalidRequest)
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError)
        expect((error as SDKError).cause).toBeInstanceOf(ValidationError)
        expect((error as SDKError).cause.message).toBe(
          'Required parameter "fromChain" is missing.'
        )
      }
    })

    it('should throw SDKError when fromToken is missing', async () => {
      const invalidRequest = createMockContractCallsRequest({
        fromToken: undefined as any,
      })

      await expect(
        getContractCallsQuote(config, invalidRequest)
      ).rejects.toThrow(SDKError)

      try {
        await getContractCallsQuote(config, invalidRequest)
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError)
        expect((error as SDKError).cause).toBeInstanceOf(ValidationError)
        expect((error as SDKError).cause.message).toBe(
          'Required parameter "fromToken" is missing.'
        )
      }
    })

    it('should throw SDKError when fromAddress is missing', async () => {
      const invalidRequest = createMockContractCallsRequest({
        fromAddress: undefined as any,
      })

      await expect(
        getContractCallsQuote(config, invalidRequest)
      ).rejects.toThrow(SDKError)

      try {
        await getContractCallsQuote(config, invalidRequest)
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError)
        expect((error as SDKError).cause).toBeInstanceOf(ValidationError)
        expect((error as SDKError).cause.message).toBe(
          'Required parameter "fromAddress" is missing.'
        )
      }
    })

    it('should throw SDKError when toChain is missing', async () => {
      const invalidRequest = createMockContractCallsRequest({
        toChain: undefined as any,
      })

      await expect(
        getContractCallsQuote(config, invalidRequest)
      ).rejects.toThrow(SDKError)

      try {
        await getContractCallsQuote(config, invalidRequest)
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError)
        expect((error as SDKError).cause).toBeInstanceOf(ValidationError)
        expect((error as SDKError).cause.message).toBe(
          'Required parameter "toChain" is missing.'
        )
      }
    })

    it('should throw SDKError when toToken is missing', async () => {
      const invalidRequest = createMockContractCallsRequest({
        toToken: undefined as any,
      })

      await expect(
        getContractCallsQuote(config, invalidRequest)
      ).rejects.toThrow(SDKError)

      try {
        await getContractCallsQuote(config, invalidRequest)
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError)
        expect((error as SDKError).cause).toBeInstanceOf(ValidationError)
        expect((error as SDKError).cause.message).toBe(
          'Required parameter "toToken" is missing.'
        )
      }
    })

    it('should throw SDKError when contractCalls is missing', async () => {
      const invalidRequest = createMockContractCallsRequest({
        contractCalls: undefined as any,
      })

      await expect(
        getContractCallsQuote(config, invalidRequest)
      ).rejects.toThrow(SDKError)

      try {
        await getContractCallsQuote(config, invalidRequest)
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError)
        expect((error as SDKError).cause).toBeInstanceOf(ValidationError)
        expect((error as SDKError).cause.message).toBe(
          'Required parameter "contractCalls" is missing.'
        )
      }
    })

    it('should throw SDKError when both fromAmount and toAmount are missing', async () => {
      const invalidRequest = createMockContractCallsRequest()
      // Remove both fromAmount and toAmount to test validation
      delete (invalidRequest as any).fromAmount
      delete (invalidRequest as any).toAmount

      await expect(
        getContractCallsQuote(config, invalidRequest)
      ).rejects.toThrow(SDKError)

      try {
        await getContractCallsQuote(config, invalidRequest)
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError)
        expect((error as SDKError).cause).toBeInstanceOf(ValidationError)
        expect((error as SDKError).cause.message).toBe(
          'Required parameter "fromAmount" or "toAmount" is missing.'
        )
      }
    })
  })

  describe('error scenarios', () => {
    it('should throw SDKError when network request fails', async () => {
      server.use(
        http.post(`${config.apiUrl}/quote/contractCalls`, async () => {
          return HttpResponse.error()
        })
      )

      const request = createMockContractCallsRequest()

      await expect(getContractCallsQuote(config, request)).rejects.toThrow(
        SDKError
      )
    })

    it('should throw SDKError when request times out', async () => {
      server.use(
        http.post(`${config.apiUrl}/quote/contractCalls`, async () => {
          // Simulate timeout by not responding
          await new Promise(() => {}) // Never resolves
        })
      )

      const request = createMockContractCallsRequest()
      const timeoutOptions: RequestOptions = {
        signal: AbortSignal.timeout(100), // 100ms timeout
      }

      await expect(
        getContractCallsQuote(config, request, timeoutOptions)
      ).rejects.toThrow()
    })
  })
})
