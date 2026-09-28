import {
  BaseError,
  ErrorName,
  LiFiErrorCode,
  SDKError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { parseBitcoinErrors } from './parseBitcoinErrors.js'

describe('parseBitcoinErrors', () => {
  it('should return SDKError as-is', async () => {
    const error = new SDKError(
      new BaseError(
        ErrorName.UnknownError,
        LiFiErrorCode.InternalError,
        'there was an error'
      )
    )

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError).toBe(error)
  })

  it('should handle signature rejected error', async () => {
    const error = { code: 4001, message: 'User rejected' } as any

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
  })

  it("maps bigmi's UserRejectedRequestError to SignatureRejected", async () => {
    // bigmi's RpcErrorCode.USER_REJECTION is -32000.
    const error = Object.assign(
      new Error('UserRejectedRequestError:  User rejected'),
      { name: 'UserRejectedRequestError', code: -32000 }
    )

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
  })

  it('does not treat an AbortError as a user rejection', async () => {
    const error = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    })

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })

  it('keeps TransactionExpired when signing took too long', async () => {
    const error = new TransactionError(
      LiFiErrorCode.TransactionExpired,
      'Transaction has expired.'
    )

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError.cause).toBe(error)
  })

  it('should handle generic Error', async () => {
    const error = new Error('Something went wrong')

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })
})
