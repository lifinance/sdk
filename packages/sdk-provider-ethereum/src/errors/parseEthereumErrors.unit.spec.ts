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

describe('parseEVMStepErrors', () => {
  describe('when a SDKError is passed', async () => {
    it('should return the original error', async () => {
      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        )
      )

      const parsedError = await parseEthereumErrors(error)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBeUndefined()
    })
  })

  describe('when step is passed', () => {
    it('should return the original error with step added', async () => {
      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        )
      )

      const step = buildStepObject({ includingExecution: true })

      const parsedError = await parseEthereumErrors(error, step)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBe(step)
    })
  })

  describe('when the SDKError already has a step', () => {
    it('should return the original error with the existing step', async () => {
      const expectedStep = buildStepObject({ includingExecution: true })

      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        ),
        expectedStep
      )

      const step = buildStepObject({ includingExecution: true })

      const parsedError = await parseEthereumErrors(error, step)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBe(expectedStep)
    })
  })

  describe('when a BaseError is passed', () => {
    it('should return the BaseError as the cause on a SDKError', async () => {
      const error = new BaseError(
        ErrorName.BalanceError,
        LiFiErrorCode.BalanceError,
        'there was an error'
      )

      const parsedError = await parseEthereumErrors(error)

      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.cause).toBe(error)
    })

    describe('when step is passed', () => {
      it('should return the SDKError with step added', async () => {
        const error = new BaseError(
          ErrorName.BalanceError,
          LiFiErrorCode.BalanceError,
          'there was an error'
        )

        const step = buildStepObject({ includingExecution: true })

        const parsedError = await parseEthereumErrors(error, step)

        expect(parsedError).toBeInstanceOf(SDKError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.cause).toBe(error)
      })
    })
  })

  describe('when a generic Error is passed', () => {
    it('should return the Error as the cause on a BaseError which is wrapped in an SDKError', async () => {
      const error = new Error('Somethings fishy')

      const parsedError = await parseEthereumErrors(error)
      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.step).toBeUndefined()

      const baseError = parsedError.cause
      expect(baseError).toBeInstanceOf(BaseError)

      const causeError = baseError.cause
      expect(causeError).toBe(error)
    })

    describe('when step is passed', () => {
      it('should return an SDKError with step added', async () => {
        const error = new Error('Somethings fishy')

        const step = buildStepObject({ includingExecution: true })

        const parsedError = await parseEthereumErrors(error, step)
        expect(parsedError).toBeInstanceOf(SDKError)
        expect(parsedError.step).toBe(step)
      })
    })
  })

  describe('when specific Errors are passed', () => {
    describe('when the error is the viem UserRejectedRequestError error', () => {
      it('should return the BaseError with the SignatureRejected code as the cause on a SDKError', async () => {
        const mockViemError = new Error()
        const UserRejectedRequestError = new Error()
        UserRejectedRequestError.name = 'UserRejectedRequestError'
        mockViemError.cause = UserRejectedRequestError

        const parsedError = await parseEthereumErrors(mockViemError)

        expect(parsedError).toBeInstanceOf(SDKError)

        const baseError = parsedError.cause
        expect(baseError).toBeInstanceOf(TransactionError)
        expect(baseError.code).toEqual(LiFiErrorCode.SignatureRejected)

        expect(baseError.cause?.cause).toBe(UserRejectedRequestError)
      })
    })
  })

  describe('when the error is a Transaction reverted error caused by low gas', () => {
    it('should return the TransactionError with the GasLimitError code and GasLimitLow message', async () => {
      vi.spyOn(helpers, 'fetchTxErrorDetails').mockResolvedValue({
        error_message: 'out of gas',
      })

      const mockTransactionError = new TransactionError(
        LiFiErrorCode.TransactionFailed,
        ErrorMessage.TransactionReverted
      )

      const mockStep = buildStepObject({ includingExecution: true })
      // Set txHash on the SWAP transaction (which matches execution.type)
      const swapTransaction = mockStep.execution!.actions.find(
        (t) => t.type === mockStep.execution!.type
      )
      swapTransaction!.txHash =
        '0x5c73f72a72a75d8b716ed42cd620042f53b958f028d0c9ad772908b7791c017b'

      const parsedError = await parseEthereumErrors(
        mockTransactionError,
        mockStep,
        mockStep.execution!.type
      )

      expect(parsedError).toBeInstanceOf(SDKError)

      const baseError = parsedError.cause
      expect(baseError).toBeInstanceOf(TransactionError)
      expect(baseError.code).toEqual(LiFiErrorCode.GasLimitError)
      expect(baseError.message).toEqual(ErrorMessage.GasLimitLow)
      expect(baseError.cause).toBe(mockTransactionError)

      vi.clearAllMocks()
    })
  })
})
