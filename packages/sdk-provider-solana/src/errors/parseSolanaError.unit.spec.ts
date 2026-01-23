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

describe('parseSolanaErrors', () => {
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

      const parsedError = await parseSolanaErrors(error, step)

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

      const parsedError = await parseSolanaErrors(error, newStep)

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

      const parsedError = await parseSolanaErrors(error, step)

      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.step).toBe(step)
      expect(parsedError.cause).toBe(error)
    })
  })

  describe('when generic Error is passed', () => {
    it('should wrap in UnknownError then SDKError', async () => {
      const error = new Error('Something went wrong')
      const step = buildStepObject()

      const parsedError = await parseSolanaErrors(error, step)

      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.step).toBe(step)
      expect(parsedError.cause).toBeInstanceOf(BaseError)
      expect(parsedError.cause.cause).toBe(error)
    })
  })

  describe('when Solana-specific errors are passed', () => {
    it('should handle WalletSignTransactionError', async () => {
      const mockSolanaError = new Error()
      mockSolanaError.name = 'WalletSignTransactionError'

      const parsedError = await parseSolanaErrors(mockSolanaError)

      expect(parsedError).toBeInstanceOf(SDKError)
      expect(parsedError.cause).toBeInstanceOf(TransactionError)
      expect(parsedError.cause.code).toEqual(LiFiErrorCode.SignatureRejected)
    })
  })
})
