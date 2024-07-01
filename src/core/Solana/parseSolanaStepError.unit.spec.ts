import { beforeAll, describe, expect, it } from 'vitest'
import { buildStepObject } from '../../../tests/fixtures.js'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { LiFiSDKError } from '../../utils/errors/SDKError.js'
import { LiFiBaseError } from '../../utils/errors/baseError.js'
import { LiFiErrorCode } from '../../utils/errors/constants.js'
import { parseSolanaStepErrors } from './parseSolanaStepErrors.js'
import { ErrorName } from '../../utils/errors/constants.js'
beforeAll(setupTestEnvironment)

// TODO: tests here should test the branching statements in the parse function
//  but we will try to test the specific errors from the stepExecutor steps
describe('parseSolanaStepError', () => {
  describe('when a LiFiSDKError is passed', () => {
    it('should return the original error', async () => {
      const error = new LiFiSDKError(
        new LiFiBaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        )
      )

      const parsedError = await parseSolanaStepErrors(error)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBeUndefined()
      expect(parsedError.process).toBeUndefined()
    })

    describe('when step and process is passed', () => {
      it('should return the original error with step and process added', async () => {
        const error = new LiFiSDKError(
          new LiFiBaseError(
            ErrorName.UnknownError,
            LiFiErrorCode.InternalError,
            'there was an error'
          )
        )

        const step = buildStepObject({ includingExecution: true })
        const process = step.execution!.process[0]

        const parsedError = await parseSolanaStepErrors(error, step, process)

        expect(parsedError).toBe(error)

        expect(parsedError.step).toBe(step)
        expect(parsedError.process).toBe(process)
      })

      describe('when the LiFiSDKError already has a step and process', () => {
        it('should return the original error with teh existing step and process specified', async () => {
          const expectedStep = buildStepObject({ includingExecution: true })
          const expectedProcess = expectedStep.execution!.process[0]

          const error = new LiFiSDKError(
            new LiFiBaseError(
              ErrorName.UnknownError,
              LiFiErrorCode.InternalError,
              'there was an error'
            ),
            expectedStep,
            expectedProcess
          )

          const step = buildStepObject({ includingExecution: true })
          const process = step.execution!.process[0]

          const parsedError = await parseSolanaStepErrors(error, step, process)

          expect(parsedError).toBe(error)

          expect(parsedError.step).toBe(expectedStep)
          expect(parsedError.process).toBe(expectedProcess)
        })
      })
    })
  })

  describe('when a LiFBaseError is passed', () => {
    it('should return the LiFBaseError as the cause on a LiFiSDKError', async () => {
      const error = new LiFiBaseError(
        ErrorName.BalanceError,
        LiFiErrorCode.BalanceError,
        'there was an error'
      )

      const parsedError = await parseSolanaStepErrors(error)

      expect(parsedError).toBeInstanceOf(LiFiSDKError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.process).toBeUndefined()
      expect(parsedError.cause).toBe(error)
    })

    describe('when step and process is passed', () => {
      it('should return the LiFiSDKError with step and process added', async () => {
        const error = new LiFiBaseError(
          ErrorName.BalanceError,
          LiFiErrorCode.BalanceError,
          'there was an error'
        )

        const step = buildStepObject({ includingExecution: true })
        const process = step.execution!.process[0]

        const parsedError = await parseSolanaStepErrors(error, step, process)

        expect(parsedError).toBeInstanceOf(LiFiSDKError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.process).toBe(process)
        expect(parsedError.cause).toBe(error)
      })
    })
  })

  describe('when a generic Error is passed', () => {
    it('should return the Error as he cause on a LiFBaseError which is wrapped in an LiFiSDKError', async () => {
      const error = new Error('Somethings fishy')

      const parsedError = await parseSolanaStepErrors(error)
      expect(parsedError).toBeInstanceOf(LiFiSDKError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.process).toBeUndefined()

      const baseError = parsedError.cause
      expect(baseError).toBeInstanceOf(LiFiBaseError)

      const causeError = baseError.cause
      expect(causeError).toBe(error)
    })

    describe('when step and process is passed', () => {
      it('should return an LiFiSDKError with step and process added', async () => {
        const error = new Error('Somethings fishy')

        const step = buildStepObject({ includingExecution: true })
        const process = step.execution?.process[0]

        const parsedError = await parseSolanaStepErrors(error, step, process)
        expect(parsedError).toBeInstanceOf(LiFiSDKError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.process).toBe(process)
      })
    })
  })
})
