import {
  BaseError,
  ErrorMessage,
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

  it('should handle transaction failed error', async () => {
    const error = new Error('Transaction failed')

    const parsedError = await parseSuiErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.TransactionFailed)
  })

  it('maps an Error that says "simulate" to TransactionSimulationFailed', async () => {
    const error = new Error('Could not simulate the call')

    const parsedError = await parseSuiErrors(error)

    expect(parsedError.cause).toBeInstanceOf(TransactionError)
    expect(parsedError.cause.code).toBe(
      LiFiErrorCode.TransactionSimulationFailed
    )
    expect(parsedError.cause.cause).toBe(error)
  })

  // The sign task tags a wallet rejection where it happens
  // (SuiSignAndExecuteTask). Here "reject" is only text from a node or an RPC.
  it('does not read "reject" in a node message as a wallet rejection', async () => {
    const error = new Error('Transaction rejected by validator')

    const parsedError = await parseSuiErrors(error)

    expect(parsedError.cause).toBeInstanceOf(UnknownError)
    expect(parsedError.cause.code).toBe(LiFiErrorCode.InternalError)
    expect(parsedError.cause.cause).toBe(error)
  })

  it.each([
    [
      'a node refusal that says "rejected"',
      new TransactionError(
        LiFiErrorCode.TransactionConflict,
        'The node rejected the transaction.'
      ),
    ],
    [
      'an expiry that says "Transaction failed"',
      new TransactionError(
        LiFiErrorCode.TransactionExpired,
        'Transaction failed to execute before it expired.'
      ),
    ],
    [
      'a preparation error that says "simulation"',
      new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Transaction simulation was skipped.'
      ),
    ],
    [
      'the tagged rejection that says "Transaction error"',
      new TransactionError(
        LiFiErrorCode.SignatureRejected,
        'Transaction error: the wallet window was closed.'
      ),
    ],
    [
      'the final failed execution',
      new TransactionError(
        LiFiErrorCode.TransactionFailed,
        'Transaction failed: MoveAbort in 0x2::coin',
        undefined,
        { final: true }
      ),
    ],
  ])('returns %s unchanged', async (_label, error) => {
    const parsedError = await parseSuiErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBe(error)
    expect(parsedError.code).toBe(error.code)
  })

  it.each([undefined, null])(
    'maps a thrown %s to UnknownError',
    async (thrown) => {
      const parsedError = await parseSuiErrors(thrown as never)

      expect(parsedError.cause).toBeInstanceOf(UnknownError)
      expect(parsedError.cause.message).toBe(ErrorMessage.UnknownError)
    }
  )

  // A TypeError here would escape the catch of the step executor.
  it.each([
    ['an object whose message is a number', { message: 42 }],
    ['a string', 'Wallet is locked'],
  ])('maps %s to UnknownError without a TypeError', async (_label, thrown) => {
    const parsedError = await parseSuiErrors(thrown as never)

    expect(parsedError.cause).toBeInstanceOf(UnknownError)
    expect(parsedError.cause.message).toBe(ErrorMessage.UnknownError)
    expect(parsedError.cause.cause).toBe(thrown)
  })

  it('should handle generic Error', async () => {
    const error = new Error('Something went wrong')

    const parsedError = await parseSuiErrors(error)

    expect(parsedError).toBeInstanceOf(SDKError)
    expect(parsedError.cause).toBeInstanceOf(UnknownError)
  })
})
