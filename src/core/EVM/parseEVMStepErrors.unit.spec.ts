import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { parseEVMStepErrors } from './parseEVMStepErrors.js'
import {
  ErrorName,
  LiFiBaseError,
  LiFiErrorCode,
  LiFiSDKError,
} from '../../utils/index.js'
import { buildStepObject } from '../../../tests/fixtures.js'

beforeAll(setupTestEnvironment)

describe('parseEVMStepErrors', () => {
  describe('when a LiFiSDKError is passed', async () => {
    it('should return the original error', async () => {
      const error = new LiFiSDKError(
        new LiFiBaseError(
          ErrorName.UnknownError,
          LiFiErrorCode.InternalError,
          'there was an error'
        )
      )

      const parsedError = await parseEVMStepErrors(error)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBeUndefined()
      expect(parsedError.process).toBeUndefined()
    })
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

      const parsedError = await parseEVMStepErrors(error, step, process)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBe(step)
      expect(parsedError.process).toBe(process)
    })
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

      const parsedError = await parseEVMStepErrors(error, step, process)

      expect(parsedError).toBe(error)

      expect(parsedError.step).toBe(expectedStep)
      expect(parsedError.process).toBe(expectedProcess)
    })
  })

  describe('when a LiFBaseError is passed', () => {
    it('should return the LiFBaseError as the cause on a LiFiSDKError', async () => {
      const error = new LiFiBaseError(
        ErrorName.BalanceError,
        LiFiErrorCode.BalanceError,
        'there was an error'
      )

      const parsedError = await parseEVMStepErrors(error)

      expect(parsedError).toBeInstanceOf(LiFiSDKError)
      expect(parsedError.step).toBeUndefined()
      expect(parsedError.process).toBeUndefined()
      expect(parsedError.cause).toBe(error)
    })

    describe('when a LiFBaseError is passed uses Transaction failed code and step and process values are present', () => {
      it.todo(
        'should return a transaction error with the allowance required error code',
        () => {}
      )
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

        const parsedError = await parseEVMStepErrors(error, step, process)

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

      const parsedError = await parseEVMStepErrors(error)
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

        const parsedError = await parseEVMStepErrors(error, step, process)
        expect(parsedError).toBeInstanceOf(LiFiSDKError)
        expect(parsedError.step).toBe(step)
        expect(parsedError.process).toBe(process)
      })
    })
  })
})
