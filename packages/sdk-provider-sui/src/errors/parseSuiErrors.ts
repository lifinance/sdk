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

  // `e` can be any thrown value: also `undefined`, `null`, a string, or an
  // object whose `message` is not a string. A TypeError here would escape the
  // catch of the step executor.
  const message: string = typeof e?.message === 'string' ? e.message : ''
  const lowerCaseMessage = message.toLowerCase()

  if (
    lowerCaseMessage.includes('transaction') &&
    (lowerCaseMessage.includes('failed') || lowerCaseMessage.includes('error'))
  ) {
    return new TransactionError(LiFiErrorCode.TransactionFailed, message, e)
  }

  if (message.includes('simulate') || message.includes('simulation')) {
    return new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      message,
      e
    )
  }

  return new UnknownError(message || ErrorMessage.UnknownError, e)
}
