import type { Process } from '@lifi/sdk'
import {
  BaseError,
  ErrorMessage,
  LiFiErrorCode,
  SDKError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'
import type { LiFiStep } from '@lifi/types'

export const parseSolanaErrors = async (
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
