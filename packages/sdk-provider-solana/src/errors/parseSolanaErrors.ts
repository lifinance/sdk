import {
  BaseError,
  ErrorMessage,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStep,
  SDKError,
  type StepExecutionError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'

export const parseSolanaErrors = async (
  e: StepExecutionError,
  step?: LiFiStep,
  action?: ExecutionAction
): Promise<SDKError> => {
  const resolvedAction = action ?? e.action
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    e.action = e.action ?? resolvedAction
    return e
  }

  const baseError = handleSpecificErrors(e)

  return new SDKError(baseError, step, resolvedAction)
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
