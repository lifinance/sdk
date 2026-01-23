import {
  BaseError,
  ErrorMessage,
  LiFiErrorCode,
  type LiFiStepExtended,
  SDKError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'

export const parseSolanaErrors = async (
  e: Error,
  step?: LiFiStepExtended
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    return e
  }

  const baseError = handleSpecificErrors(e)

  return new SDKError(baseError, step)
}

const handleSpecificErrors = (e: any) => {
  if (e.name === 'WalletSignTransactionError') {
    return new TransactionError(LiFiErrorCode.SignatureRejected, e.message, e)
  }

  if (e.name === 'SendTransactionError') {
    return new TransactionError(LiFiErrorCode.TransactionFailed, e.message, e)
  }

  if (e.name === 'TransactionExpiredBlockheightExceededError') {
    return new TransactionError(LiFiErrorCode.TransactionExpired, e.message, e)
  }

  if (e.message?.includes('simulate')) {
    return new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      e.message,
      e
    )
  }

  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(e.message || ErrorMessage.UnknownError, e)
}
