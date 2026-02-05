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

export const parseBitcoinErrors = async (
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
