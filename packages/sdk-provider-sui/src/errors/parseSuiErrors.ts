import {
  BaseError,
  ErrorMessage,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStep,
  SDKError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'

export const parseSuiErrors = async (
  e: Error,
  step?: LiFiStep,
  action?: ExecutionAction
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    e.action = e.action ?? action
    return e
  }

  const baseError = handleSpecificErrors(e)

  return new SDKError(baseError, step, action)
}

const handleSpecificErrors = (e: any): BaseError => {
  // A code the SDK set on purpose wins over message matching. A wallet
  // rejection is tagged where it happens (SuiSignAndExecuteTask), so "reject"
  // is not read here: a node or RPC message that says "reject" is not the
  // user's.
  if (e instanceof BaseError) {
    return e
  }

  // `e` can be any thrown value, also `undefined` or `null`.
  if (
    e?.message?.toLowerCase().includes('transaction') &&
    (e.message.toLowerCase().includes('failed') ||
      e.message.toLowerCase().includes('error'))
  ) {
    return new TransactionError(LiFiErrorCode.TransactionFailed, e.message, e)
  }

  if (e?.message?.includes('simulate') || e?.message?.includes('simulation')) {
    return new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      e.message,
      e
    )
  }

  return new UnknownError(e?.message || ErrorMessage.UnknownError, e)
}
