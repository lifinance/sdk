import * as helpers from '@lifi/sdk'
import {
  BaseError,
  ErrorMessage,
  ErrorName,
  LiFiErrorCode,
  SDKError,
  TransactionError,
} from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
import { buildStepObject } from '../actions/switchChain.unit.mock.js'
import { parseEthereumErrors } from './parseEthereumErrors.js'

describe('parseEthereumErrors', () => {
  describe('when SDKError is passed', () => {
    it('should return original error and add step if not present', async () => {
      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        )
      )
      const step = buildStepObject()

      const parsedError = await parseEthereumErrors(error, step)

      expect(parsedError).toBe(error)
      expect(parsedError.step).toBe(step)
    })

    it('should preserve existing step', async () => {
      const existingStep = buildStepObject()
      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        ),
        existingStep
      )
      const newStep = buildStepObject()

      const parsedError = await parseEthereumErrors(error, newStep)

      expect(parsedError).toBe(error)
      expect(parsedError.step).toBe(existingStep)
    })
  })

  describe('when BaseError is passed', () => {
    it('should wrap in SDKError with step', async () => {
      const error = new BaseError(
        ErrorName.BalanceError,
        LiFiErrorCode.BalanceError,
        'there was an error'
      )
      const step = buildStepObject()

      const parsedError = await parseEthereumErrors(error, step)

      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.step).toBe(step)
      expect(parsedError.cause).toBe(error)
    })
  })

  describe('when generic Error is passed', () => {
    it('should wrap in UnknownError then SDKError', async () => {
      const error = new Error('Something went wrong')
      const step = buildStepObject()

      const parsedError = await parseEthereumErrors(error, step)

      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.step).toBe(step)
      expect(parsedError.cause).toBeInstanceOf(BaseError)
      expect(parsedError.cause.cause).toBe(error)
    })
  })

  describe('when specific errors are passed', () => {
    it('should handle viem UserRejectedRequestError', async () => {
      const userRejectedError = new Error()
      userRejectedError.name = 'UserRejectedRequestError'
      const mockViemError = new Error()
      mockViemError.cause = userRejectedError

      const parsedError = await parseEthereumErrors(mockViemError)

      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.cause).toBeInstanceOf(TransactionError)
      expect(parsedError.cause.code).toEqual(LiFiErrorCode.SignatureRejected)
    })

    it('should detect low gas from transaction reverted error', async () => {
      vi.spyOn(helpers, 'fetchTxErrorDetails').mockResolvedValue({
        error_message: 'out of gas',
      })

      const mockStep = buildStepObject()
      const swapAction = mockStep.execution!.actions.find(
        (a) => a.type === mockStep.execution!.type
      )
      swapAction!.txHash =
        '0x5c73f72a72a75d8b716ed42cd620042f53b958f028d0c9ad772908b7791c017b'

      const mockTransactionError = new TransactionError(
        LiFiErrorCode.TransactionFailed,
        ErrorMessage.TransactionReverted
      )

      const parsedError = await parseEthereumErrors(
        mockTransactionError,
        mockStep
      )

      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.cause).toBeInstanceOf(TransactionError)
      expect(parsedError.cause.code).toEqual(LiFiErrorCode.GasLimitError)
      expect(parsedError.cause.message).toEqual(ErrorMessage.GasLimitLow)

      vi.clearAllMocks()
    })
  })
})
