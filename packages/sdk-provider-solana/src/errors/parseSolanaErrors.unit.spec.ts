import {
  BaseError,
  ErrorName,
  LiFiErrorCode,
  SDKError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { parseSolanaErrors } from './parseSolanaErrors.js'

describe('parseSolanaErrors', () => {
  it('should return SDKError as-is', async () => {
    const error = new SDKError(
      new BaseError(
        ErrorName.UnknownError,
        LiFiErrorCode.InternalError,
        'there was an error'
      )
    )

    const parsedError = await parseSolanaErrors(error)

    expect(parsedError).toBe(error)
  })

  it('should handle WalletSignTransactionError', async () => {
    const error = { name: 'WalletSignTransactionError', message: 'rejected' }

    const parsedError = await parseSolanaErrors(error as any)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
  })

  it('should handle SendTransactionError', async () => {
    const error = { name: 'SendTransactionError', message: 'failed' }

    const parsedError = await parseSolanaErrors(error as any)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.TransactionFailed)
  })

  it('should handle transaction expired error', async () => {
    const error = {
      name: 'TransactionExpiredBlockheightExceededError',
      message: 'expired',
    }

    const parsedError = await parseSolanaErrors(error as any)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.TransactionExpired)
  })

  it('should handle generic Error', async () => {
    const error = new Error('Something went wrong')

    const parsedError = await parseSolanaErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })
})
