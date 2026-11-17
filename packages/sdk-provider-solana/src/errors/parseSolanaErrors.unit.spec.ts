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

  it('maps a wallet rejection with code 4001 to SignatureRejected', async () => {
    const error = Object.assign(new Error('Request declined.'), { code: 4001 })

    const parsedError = await parseSolanaErrors(error)

    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
  })

  it.each([
    'User rejected the request.',
    'user denied transaction signature',
    'Transaction cancelled by the user',
  ])('maps the rejection message %j to SignatureRejected', async (message) => {
    const parsedError = await parseSolanaErrors(new Error(message))

    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
  })

  it.each([
    Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    }),
    new Error('Request rejected by the node'),
  ])('does not treat %o as a user rejection', async (error) => {
    const parsedError = await parseSolanaErrors(error)

    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })

  it.each([
    ['SendTransactionError', LiFiErrorCode.TransactionFailed],
    [
      'TransactionExpiredBlockheightExceededError',
      LiFiErrorCode.TransactionExpired,
    ],
  ])('keeps %s when its logs look like a rejection', async (name, code) => {
    const error = {
      name,
      message: 'Program log: order cancelled by the user',
    }

    const parsedError = await parseSolanaErrors(error as any)

    expect(parsedError.cause.code).toBe(code)
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
      const parsedError = await parseSolanaErrors(new Error(message))

      expect(parsedError.cause).toBeInstanceOf(TransactionError)
      expect(parsedError.cause.code).toBe(LiFiErrorCode.SignatureRejected)
    }
  )

  it('maps a wallet cancel and keeps the wallet error as its cause', async () => {
    // An Android in-app wallet rejects signAllTransactions with this error
    // when the user taps Cancel (Sentry JUMPER-FRONT-BC).
    const walletError = new Error('Transaction canceled')

    const parsedError = await parseSolanaErrors(walletError)

    expect(parsedError.code).toBe(LiFiErrorCode.SignatureRejected)
    expect(parsedError.cause.message).toBe('Transaction canceled')
    expect(parsedError.cause.cause).toBe(walletError)
  })

  it.each([
    'Transaction canceled: insufficient priority fee',
    'Pending transaction canceled',
  ])('does not treat %j as a wallet cancel', async (message) => {
    const parsedError = await parseSolanaErrors(new Error(message))

    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })

  it('keeps SendTransactionError when its message is a cancel', async () => {
    const error = {
      name: 'SendTransactionError',
      message: 'Transaction canceled',
    }

    const parsedError = await parseSolanaErrors(error as any)

    expect(parsedError.cause.code).toBe(LiFiErrorCode.TransactionFailed)
  })

  it('keeps the code of an SDK error whose message is a cancel', async () => {
    const error = new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Transaction canceled'
    )

    const parsedError = await parseSolanaErrors(error)

    expect(parsedError.cause).toBe(error)
  })

  it('keeps the code of an SDK error whose message looks like a rejection', async () => {
    const error = new TransactionError(
      LiFiErrorCode.TransactionCanceled,
      'Transaction cancelled by the user'
    )

    const parsedError = await parseSolanaErrors(error)

    expect(parsedError.cause).toBe(error)
  })

  it('keeps TransactionExpired when signing took too long', async () => {
    const error = new TransactionError(
      LiFiErrorCode.TransactionExpired,
      'Transaction has expired: blockhash is no longer recent enough.'
    )

    const parsedError = await parseSolanaErrors(error)

    expect(parsedError.cause).toBe(error)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.TransactionExpired)
  })

  it('should handle generic Error', async () => {
    const error = new Error('Something went wrong')

    const parsedError = await parseSolanaErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })
})
