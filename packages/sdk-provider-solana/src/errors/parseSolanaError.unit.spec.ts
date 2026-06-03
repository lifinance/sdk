import {
  BaseError,
  ErrorName,
  LiFiErrorCode,
  SDKError,
  TransactionError,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { buildStepObject } from './parseSolanaError.unit.mock.js'
import { parseSolanaErrors } from './parseSolanaErrors.js'

describe('parseSolanaStepError', () => {
  describe('when a SDKError is passed', () => {
    it('should return the original error', async () => {
      const error = new SDKError(
        new BaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        )
      )

      const parsedError = await parseSolanaErrors(error)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBeUndefined()
      expect(parsedError.action).toBeUndefined()
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

        const parsedError = await parseSolanaErrors(error, step, action)

        expect(parsedError).toBe(error)

        expect(parsedError.step).toBe(step)
        expect(parsedError.action).toBe(action)
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

          const parsedError = await parseSolanaErrors(error, step, action)

          expect(parsedError).toBe(error)

          expect(parsedError.step).toBe(expectedStep)
          expect(parsedError.action).toBe(expectedAction)
        })
      })
    })
  })

  describe('when a BaseError is passed', () => {
    it('should return the BaseError as the cause on a SDKError', async () => {
      const error = new BaseError(
        ErrorName.BalanceError,
        LiFiErrorCode.BalanceError,
        'there was an error'
      )

      const parsedError = await parseSolanaErrors(error)

      expect(parsedError).toBeInstanceOf(SDKError)
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

        const parsedError = await parseSolanaErrors(error, step, action)

        expect(parsedError).toBeInstanceOf(SDKError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.action).toBe(action)
        expect(parsedError.cause).toBe(error)
      })
    })
  })

  describe('when a generic Error is passed', () => {
    it('should return the Error as he cause on a BaseError which is wrapped in an SDKError', async () => {
      const error = new Error('Somethings fishy')

      const parsedError = await parseSolanaErrors(error)
      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.action).toBeUndefined()

      const baseError = parsedError.cause
      expect(baseError).toBeInstanceOf(BaseError)

      const causeError = baseError.cause
      expect(causeError).toBe(error)
    })

    describe('when step and action is passed', () => {
      it('should return an SDKError with step and action added', async () => {
        const error = new Error('Somethings fishy')

        const step = buildStepObject({ includingExecution: true })
        const action = step.execution?.actions[0]

        const parsedError = await parseSolanaErrors(error, step, action)
        expect(parsedError).toBeInstanceOf(SDKError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.action).toBe(action)
      })
    })
  })

  describe('when Solana Errors are passed', () => {
    describe('when the error is a WalletSignTransactionError', () => {
      it('should return the BaseError with the SignatureRejected code as the cause on a SDKError', async () => {
        const MockSolanaError = new Error()
        MockSolanaError.name = 'WalletSignTransactionError'

        const parsedError = await parseSolanaErrors(MockSolanaError)

        expect(parsedError).toBeInstanceOf(SDKError)

        const baseError = parsedError.cause
        expect(baseError).toBeInstanceOf(TransactionError)
        expect(baseError.code).toEqual(LiFiErrorCode.SignatureRejected)

        expect(baseError.cause).toBe(MockSolanaError)
      })
    })
  })
})
