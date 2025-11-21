import {
  BaseError,
  ErrorName,
  LiFiErrorCode,
  SDKError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { parseSuiErrors } from './parseSuiErrors.js'

describe('parseSuiErrors', () => {
  it('should return SDKError as-is', async () => {
    const error = new SDKError(
      new BaseError(
        ErrorName.UnknownError,
        LiFiErrorCode.InternalError,
        'there was an error'
      )
    )

    const parsedError = await parseSuiErrors(error)

    expect(parsedError).toBe(error)
  })

  it('should handle signature rejected error', async () => {
    const error = new Error('User reject')

    const parsedError = await parseSuiErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
  })

  it('should handle transaction failed error', async () => {
    const error = new Error('Transaction failed')

    const parsedError = await parseSuiErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.TransactionFailed)
  })

  it('should handle generic Error', async () => {
    const error = new Error('Something went wrong')

    const parsedError = await parseSuiErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })
})
