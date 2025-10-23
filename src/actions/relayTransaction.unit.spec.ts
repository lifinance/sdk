import type { RelayRequest, RelayResponse, RequestOptions } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { SDKError } from '../errors/SDKError.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { relayTransaction } from './relayTransaction.js'

describe('relayTransaction', () => {
  const server = setupTestServer()

  const createMockRelayRequest = (typedData: any[]): RelayRequest => ({
    type: 'lifi',
    id: 'test-step-id',
    includedSteps: [],
    tool: 'test-tool',
    toolDetails: {
      key: 'test-tool',
      name: 'Test Tool',
      logoURI: 'https://example.com/logo.png',
    },
    action: {
      fromChainId: 1,
      toChainId: 1,
      fromToken: {
        address: '0x1234567890123456789012345678901234567890',
        symbol: 'TEST',
        decimals: 18,
        chainId: 1,
        name: 'Test Token',
        priceUSD: '1.00',
      },
      toToken: {
        address: '0x0987654321098765432109876543210987654321',
        symbol: 'TEST2',
        decimals: 18,
        chainId: 1,
        name: 'Test Token 2',
        priceUSD: '1.00',
      },
      fromAmount: '1000000000000000000',
    },
    estimate: {
      fromAmount: '1000000000000000000',
      toAmount: '1000000000000000000',
      toAmountMin: '1000000000000000000',
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
    typedData,
  })

  const mockRelayRequest: RelayRequest = createMockRelayRequest([
    {
      domain: {
        name: 'Test Token',
        version: '1',
        chainId: 1,
        verifyingContract: '0x1234567890123456789012345678901234567890',
      },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: {
        owner: '0x1234567890123456789012345678901234567890',
        spender: '0x0987654321098765432109876543210987654321',
        value: '1000000000000000000',
        nonce: 0,
        deadline: 1234567890,
      },
      signature:
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    },
  ])

  const mockRelayRequestWithPermitWitness: RelayRequest =
    createMockRelayRequest([
      {
        domain: {
          name: 'Test Token',
          version: '1',
          chainId: 1,
          verifyingContract: '0x1234567890123456789012345678901234567890',
        },
        types: {
          PermitWitnessTransferFrom: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'PermitWitnessTransferFrom',
        message: {
          owner: '0x1234567890123456789012345678901234567890',
          spender: '0x0987654321098765432109876543210987654321',
          value: '1000000000000000000',
          nonce: 0,
          deadline: 1234567890,
        },
        signature:
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
      },
    ])

  const mockSuccessResponse: RelayResponse = {
    status: 'ok',
    data: {
      taskId: 'test-task-id-123',
    },
  }

  const mockErrorResponse: RelayResponse = {
    status: 'error',
    data: {
      code: 400,
      message: 'Invalid request parameters',
    },
  }

  describe('success scenarios', () => {
    it('should relay transaction successfully for advanced relayer', async () => {
      server.use(
        http.post(`${client.config.apiUrl}/advanced/relay`, async () => {
          return HttpResponse.json(mockSuccessResponse)
        })
      )

      const result = await relayTransaction(client, mockRelayRequest)

      expect(result).toEqual(mockSuccessResponse.data)
    })

    it('should relay transaction successfully for gasless relayer', async () => {
      server.use(
        http.post(`${client.config.apiUrl}/relayer/relay`, async () => {
          return HttpResponse.json(mockSuccessResponse)
        })
      )

      const result = await relayTransaction(
        client,
        mockRelayRequestWithPermitWitness
      )

      expect(result).toEqual(mockSuccessResponse.data)
    })
  })

  describe('error scenarios', () => {
    it('should throw BaseError when server returns error status', async () => {
      server.use(
        http.post(`${client.config.apiUrl}/advanced/relay`, async () => {
          return HttpResponse.json(mockErrorResponse)
        })
      )

      await expect(relayTransaction(client, mockRelayRequest)).rejects.toThrow(
        BaseError
      )

      try {
        await relayTransaction(client, mockRelayRequest)
      } catch (error) {
        expect(error).toBeInstanceOf(BaseError)
        expect((error as BaseError).name).toBe(ErrorName.ServerError)
        expect((error as BaseError).code).toBe(400)
        expect((error as BaseError).message).toBe('Invalid request parameters')
      }
    })

    it('should throw SDKError when network request fails', async () => {
      server.use(
        http.post(`${client.config.apiUrl}/advanced/relay`, async () => {
          return HttpResponse.error()
        })
      )

      await expect(relayTransaction(client, mockRelayRequest)).rejects.toThrow(
        SDKError
      )
    })

    it('should throw SDKError when request times out', async () => {
      server.use(
        http.post(`${client.config.apiUrl}/advanced/relay`, async () => {
          // Simulate timeout by not responding
          await new Promise(() => {}) // Never resolves
        })
      )

      const timeoutOptions: RequestOptions = {
        signal: AbortSignal.timeout(100), // 100ms timeout
      }

      await expect(
        relayTransaction(client, mockRelayRequest, timeoutOptions)
      ).rejects.toThrow()
    })
  })

  describe('validation scenarios', () => {
    it('should throw SDKError when typedData is missing', async () => {
      const invalidRequest = createMockRelayRequest([])
      // Remove typedData to test validation
      delete (invalidRequest as any).typedData

      await expect(relayTransaction(client, invalidRequest)).rejects.toThrow(
        SDKError
      )
    })
  })
})
