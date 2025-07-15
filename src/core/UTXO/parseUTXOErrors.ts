import type { LiFiStep } from '@lifi/types'
import { BaseError } from '../../errors/baseError.js'
import { ErrorMessage, LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError, UnknownError } from '../../errors/errors.js'
import { SDKError } from '../../errors/SDKError.js'
import type { Process } from '../types.js'

export const parseUTXOErrors = async (
  e: Error,
  step?: LiFiStep,
  process?: Process
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    e.process = e.process ?? process
    return e
  }

  const baseError = handleSpecificErrors(e)

  return new SDKError(baseError, step, process)
}

const handleSpecificErrors = (e: any) => {
  // txn-mempool-conflict
  if (
    e.details?.includes?.('conflict') ||
    e.cause?.message?.includes?.('conflict')
  ) {
    return new TransactionError(
      LiFiErrorCode.TransactionConflict,
      'Your transaction conflicts with another transaction already in the mempool. One or more inputs have been spent by another transaction.',
      e
    )
  }
  if (e.code === 4001 || e.code === -32000 || e.cause?.includes?.('rejected')) {
    return new TransactionError(LiFiErrorCode.SignatureRejected, e.message, e)
  }
  if (e.code === -5 || e.code === -32700 || e.code === -32064) {
    return new TransactionError(LiFiErrorCode.NotFound, e.message, e)
  }

  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(e.message || ErrorMessage.UnknownError, e)
}
