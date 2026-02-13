import * as helpers from '@lifi/sdk'
import {
  BaseError,
  ErrorMessage,
  ErrorName,
  type ExecuteStepRetryError,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStep,
  SDKError,
  TransactionError,
} from '@lifi/sdk'
import { describe, expect, it, vi } from 'vitest'
import { buildStepObject } from '../execution/tasks/helpers/switchChain.unit.mock.js'
import { parseEthereumErrors } from './parseEthereumErrors.js'

function assertSDKError(
  e: SDKError | ExecuteStepRetryError
): asserts e is SDKError {
  if (!(e instanceof SDKError)) {
    throw new Error('Expected SDKError')
  }
}

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
      assertSDKError(parsedError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.action).toBeUndefined()
    })
  })

  describe('when step and action is passed', () => {
    it('should return the original error with step and action added', async () => {
      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        )
      )

      const step = buildStepObject({ includingExecution: true })
      const action = step.execution!.actions[0]

      const parsedError = await parseEthereumErrors(error, step, action)

      expect(parsedError).toBe(error)
      assertSDKError(parsedError)
      expect(parsedError.step).toBe(step)
      expect(parsedError.action).toBe(action)
    })
  })

  describe('when the SDKError already has a step and action', () => {
    it('should return the original error with the existing step and action specified', async () => {
      const expectedStep = buildStepObject({ includingExecution: true })
      const expectedAction = expectedStep.execution!.actions[0]

      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        ),
        expectedStep,
        expectedAction
      )

      const step = buildStepObject({ includingExecution: true })
      const action = step.execution!.actions[0]

      const parsedError = await parseEthereumErrors(error, step, action)

      expect(parsedError).toBe(error)
      assertSDKError(parsedError)
      expect(parsedError.step).toBe(expectedStep)
      expect(parsedError.action).toBe(expectedAction)
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
      assertSDKError(parsedError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.action).toBeUndefined()
      expect(parsedError.cause).toBe(error)
    })

    describe('when step and action is passed', () => {
      it('should return the SDKError with step and action added', async () => {
        const error = new BaseError(
          ErrorName.BalanceError,
          LiFiErrorCode.BalanceError,
          'there was an error'
        )

        const step = buildStepObject({ includingExecution: true })
        const action = step.execution!.actions[0]

        const parsedError = await parseEthereumErrors(error, step, action)

        expect(parsedError).toBeInstanceOf(SDKError)
        assertSDKError(parsedError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.action).toBe(action)
        expect(parsedError.cause).toBe(error)
      })
    })
  })

  describe('when a generic Error is passed', () => {
    it('should return the Error as the cause on a BaseError which is wrapped in an SDKError', async () => {
      const error = new Error('Somethings fishy')

      const parsedError = await parseEthereumErrors(error)
      expect(parsedError).toBeInstanceOf(SDKError)
      assertSDKError(parsedError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.action).toBeUndefined()

      const baseError = parsedError.cause
      expect(baseError).toBeInstanceOf(BaseError)

      const causeError = baseError!.cause
      expect(causeError).toBe(error)
    })

    describe('when step and action is passed', () => {
      it('should return an SDKError with step and action added', async () => {
        const error = new Error('Somethings fishy')

        const step = buildStepObject({ includingExecution: true })
        const action = step.execution?.actions[0]

        const parsedError = await parseEthereumErrors(error, step, action)
        expect(parsedError).toBeInstanceOf(SDKError)
        assertSDKError(parsedError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.action).toBe(action)
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
        assertSDKError(parsedError)

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

      const mockStep = {
        action: {
          fromChainId: 10,
        },
      } as LiFiStep

      const mockAction = {
        txHash:
          '0x5c73f72a72a75d8b716ed42cd620042f53b958f028d0c9ad772908b7791c017b',
      } as ExecutionAction

      const parsedError = await parseEthereumErrors(
        mockTransactionError,
        mockStep,
        mockAction
      )

      expect(parsedError).toBeInstanceOf(SDKError)
      assertSDKError(parsedError)

      const baseError = parsedError.cause
      expect(baseError).toBeInstanceOf(TransactionError)
      expect(baseError.code).toEqual(LiFiErrorCode.GasLimitError)
      expect(baseError.message).toEqual(ErrorMessage.GasLimitLow)
      expect(baseError.cause).toBe(mockTransactionError)

      vi.clearAllMocks()
    })
  })
})
