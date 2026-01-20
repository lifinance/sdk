import {
  BaseError,
  ErrorMessage,
  LiFiErrorCode,
  type LiFiStepExtended,
  SDKError,
  TransactionError,
  type TransactionType,
  UnknownError,
} from '@lifi/sdk'

export const parseBitcoinErrors = async (
  e: Error,
  step?: LiFiStepExtended,
  type?: TransactionType
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    e.type = e.type ?? type
    return e
  }

  const baseError = handleSpecificErrors(e)

  return new SDKError(baseError, step, type)
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
