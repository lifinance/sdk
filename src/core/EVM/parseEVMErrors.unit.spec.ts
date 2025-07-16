import type { LiFiStep } from '@lifi/types'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildStepObject } from '../../../tests/fixtures.js'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { BaseError } from '../../errors/baseError.js'
import {
  ErrorMessage,
  ErrorName,
  LiFiErrorCode,
} from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import { SDKError } from '../../errors/SDKError.js'
import * as helpers from '../../utils/fetchTxErrorDetails.js'
import type { Process } from '../types.js'
import { parseEVMErrors } from './parseEVMErrors.js'

beforeAll(setupTestEnvironment)

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

      const parsedError = await parseEVMErrors(error)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBeUndefined()
      expect(parsedError.process).toBeUndefined()
    })
  })

  describe('when step and process is passed', () => {
    it('should return the original error with step and process added', async () => {
      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        )
      )

      const step = buildStepObject({ includingExecution: true })
      const process = step.execution!.process[0]

      const parsedError = await parseEVMErrors(error, step, process)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBe(step)
      expect(parsedError.process).toBe(process)
    })
  })

  describe('when the SDKError already has a step and process', () => {
    it('should return the original error with teh existing step and process specified', async () => {
      const expectedStep = buildStepObject({ includingExecution: true })
      const expectedProcess = expectedStep.execution!.process[0]

      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        ),
        expectedStep,
        expectedProcess
      )

      const step = buildStepObject({ includingExecution: true })
      const process = step.execution!.process[0]

      const parsedError = await parseEVMErrors(error, step, process)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBe(expectedStep)
      expect(parsedError.process).toBe(expectedProcess)
    })
  })

  describe('when a BaseError is passed', () => {
    it('should return the BaseError as the cause on a SDKError', async () => {
      const error = new BaseError(
        ErrorName.BalanceError,
        LiFiErrorCode.BalanceError,
        'there was an error'
      )

      const parsedError = await parseEVMErrors(error)

      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.process).toBeUndefined()
      expect(parsedError.cause).toBe(error)
    })

    describe('when step and process is passed', () => {
      it('should return the SDKError with step and process added', async () => {
        const error = new BaseError(
          ErrorName.BalanceError,
          LiFiErrorCode.BalanceError,
          'there was an error'
        )

        const step = buildStepObject({ includingExecution: true })
        const process = step.execution!.process[0]

        const parsedError = await parseEVMErrors(error, step, process)

        expect(parsedError).toBeInstanceOf(SDKError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.process).toBe(process)
        expect(parsedError.cause).toBe(error)
      })
    })
  })

  describe('when a generic Error is passed', () => {
    it('should return the Error as he cause on a BaseError which is wrapped in an SDKError', async () => {
      const error = new Error('Somethings fishy')

      const parsedError = await parseEVMErrors(error)
      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.process).toBeUndefined()

      const baseError = parsedError.cause
      expect(baseError).toBeInstanceOf(BaseError)

      const causeError = baseError.cause
      expect(causeError).toBe(error)
    })

    describe('when step and process is passed', () => {
      it('should return an SDKError with step and process added', async () => {
        const error = new Error('Somethings fishy')

        const step = buildStepObject({ includingExecution: true })
        const process = step.execution?.process[0]

        const parsedError = await parseEVMErrors(error, step, process)
        expect(parsedError).toBeInstanceOf(SDKError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.process).toBe(process)
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

        const parsedError = await parseEVMErrors(mockViemError)

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

      const mockStep = {
        action: {
          fromChainId: 10,
        },
      } as LiFiStep

      const mockProcess = {
        txHash:
          '0x5c73f72a72a75d8b716ed42cd620042f53b958f028d0c9ad772908b7791c017b',
      } as Process

      const parsedError = await parseEVMErrors(
        mockTransactionError,
        mockStep,
        mockProcess
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
