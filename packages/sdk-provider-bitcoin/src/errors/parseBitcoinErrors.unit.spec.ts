import { BaseError as BigmiBaseError } from '@bigmi/core'
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

  it('maps a wallet cancel that bigmi wraps to SignatureRejected', async () => {
    // A wallet's injected Unisat provider rejects with this error when the
    // user taps Cancel, and bigmi wraps it (Sentry JUMPER-FRONT-XC).
    const walletError = new Error('Transaction canceled')
    const error = new BigmiBaseError('Unknown Error', { cause: walletError })

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
    expect(parsedError.cause.message).toBe('Transaction canceled')
    expect(parsedError.cause.cause).toBe(error)
  })

  it('maps a wallet cancel that is a string to SignatureRejected', async () => {
    // bigmi wraps a wallet rejection that is not an Error as "Unknown Error",
    // with the string as the cause and without details.
    const error = new BigmiBaseError('Unknown Error', {
      cause: 'Transaction canceled' as unknown as Error,
    })

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
    expect(parsedError.cause.message).toBe('Transaction canceled')
    expect(parsedError.cause.cause).toBe(error)
  })

  it('maps a wallet cancel in the short message of a bigmi error to SignatureRejected', async () => {
    // The Ctrl connector throws `new BaseError(response.error)`, and bigmi
    // passes its own errors on unchanged. The message gets bigmi's footer.
    const error = new BigmiBaseError('Transaction canceled')

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
    expect(parsedError.cause.message).toBe('Transaction canceled')
  })

  it.each([
    'Transaction canceled',
    'Transaction cancelled',
    'Transaction was canceled.',
    'Transaction canceled\n',
    ' Transaction canceled ',
  ])(
    'maps the wallet cancel message %j to SignatureRejected',
    async (message) => {
      const parsedError = await parseBitcoinErrors(new Error(message))

      expect(parsedError.cause).toBeInstanceOf(TransactionError)
      expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
      expect(parsedError.cause.message).toBe(message.trim())
    }
  )

  it.each([
    'Transaction canceled: fee rate too low',
    'Pending transaction canceled',
  ])('does not treat %j as a wallet cancel', async (message) => {
    const error = new BigmiBaseError('Unknown Error', {
      cause: new Error(message),
    })

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })

  it('does not map a bigmi error whose cause is an SDK error with a cancel message', async () => {
    const error = new BigmiBaseError('Unknown Error', {
      cause: new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'Transaction canceled'
      ),
    })

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })

  it('keeps the code of an SDK error whose message is a cancel', async () => {
    const error = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction canceled'
    )

    const parsedError = await parseBitcoinErrors(error)

    expect(parsedError.cause).toBe(error)
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
