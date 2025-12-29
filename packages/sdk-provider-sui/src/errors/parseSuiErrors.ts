import {
  BaseError,
  ErrorMessage,
  LiFiErrorCode,
  type LiFiStepExtended,
  SDKError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'

export const parseSuiErrors = async (
  e: Error,
  step?: LiFiStepExtended
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    e.execution = e.execution ?? step?.execution
    return e
  }

  const baseError = handleSpecificErrors(e)

  return new SDKError(baseError, step, step?.execution)
}

const handleSpecificErrors = (e: any) => {
  const isRejection =
    typeof e === 'string'
      ? e.toLowerCase().includes('reject')
      : e.message?.toLowerCase().includes('reject')

  if (isRejection) {
    return new TransactionError(LiFiErrorCode.SignatureRejected, e.message, e)
  }

  if (
    e.message?.toLowerCase().includes('transaction') &&
    (e.message?.toLowerCase().includes('failed') ||
      e.message?.toLowerCase().includes('error'))
  ) {
    return new TransactionError(LiFiErrorCode.TransactionFailed, e.message, e)
  }

  if (e.message?.includes('simulate') || e.message?.includes('simulation')) {
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
