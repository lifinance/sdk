import {
  BaseError,
  ErrorName,
  LiFiErrorCode,
  ProviderError,
  SDKError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'
import {
  WalletDisconnectedError,
  WalletNotFoundError,
  WalletNotSelectedError,
  WalletSignTransactionError,
  WalletWindowClosedError,
} from '@tronweb3/tronwallet-abstract-adapter'
import { describe, expect, it } from 'vitest'
import { parseTronErrors } from './parseTronErrors.js'

describe('parseTronErrors', () => {
  it('should return SDKError as-is', async () => {
    const error = new SDKError(
      new BaseError(
        ErrorName.UnknownError,
        LiFiErrorCode.InternalError,
        'error'
      )
    )

    const result = await parseTronErrors(error)

    expect(result).toBe(error)
  })

  it('should handle WalletSignTransactionError', async () => {
    const error = new WalletSignTransactionError()

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(TransactionError)
    expect(result.cause.code).toBe(LiFiErrorCode.SignatureRejected)
  })

  it('should handle WalletWindowClosedError', async () => {
    const error = new WalletWindowClosedError()

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(TransactionError)
    expect(result.cause.code).toBe(LiFiErrorCode.SignatureRejected)
  })

  it('should handle WalletNotFoundError', async () => {
    const error = new WalletNotFoundError()

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(ProviderError)
    expect(result.cause.code).toBe(LiFiErrorCode.ProviderUnavailable)
  })

  it('should handle WalletNotSelectedError', async () => {
    const error = new WalletNotSelectedError()

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(ProviderError)
    expect(result.cause.code).toBe(LiFiErrorCode.ProviderUnavailable)
  })

  it('should handle WalletDisconnectedError', async () => {
    const error = new WalletDisconnectedError()

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(TransactionError)
    expect(result.cause.code).toBe(LiFiErrorCode.WalletChangedDuringExecution)
  })

  it('should handle "Invalid transaction provided"', async () => {
    const error = new Error('Invalid transaction provided')

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(TransactionError)
    expect(result.cause.code).toBe(LiFiErrorCode.TransactionUnprepared)
  })

  it('should handle "Invalid transaction"', async () => {
    const error = new Error('Invalid transaction')

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(TransactionError)
    expect(result.cause.code).toBe(LiFiErrorCode.TransactionUnprepared)
  })

  it('should handle "Transaction is not signed"', async () => {
    const error = new Error('Transaction is not signed')

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(TransactionError)
    expect(result.cause.code).toBe(LiFiErrorCode.TransactionUnprepared)
  })

  it('should handle "Transaction is already signed"', async () => {
    const error = new Error('Transaction is already signed')

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(TransactionError)
    expect(result.cause.code).toBe(LiFiErrorCode.TransactionFailed)
  })

  it('should handle "Private key does not match address in transaction"', async () => {
    const error = new Error('Private key does not match address in transaction')

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(TransactionError)
    expect(result.cause.code).toBe(LiFiErrorCode.WalletChangedDuringExecution)
  })

  it('should handle BaseError as-is', async () => {
    const error = new BaseError(
      ErrorName.TransactionError,
      LiFiErrorCode.TransactionFailed,
      'base error'
    )

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBe(error)
  })

  it('should handle generic Error as UnknownError', async () => {
    const error = new Error('Something unexpected')

    const result = await parseTronErrors(error)

    expect(result).toBeInstanceOf(SDKError)
    expect(result.cause).toBeInstanceOf(UnknownError)
  })
})
