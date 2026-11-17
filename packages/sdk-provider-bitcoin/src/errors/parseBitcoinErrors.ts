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

export const parseBitcoinErrors = async (
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

// A wallet that reports a cancel only as this text (an injected Unisat
// provider, on Cancel). bigmi wraps it as "Unknown Error" with the wallet
// error as the cause. The whole message must match: nothing says the user
// caused it, so it maps to TransactionCanceled, not SignatureRejected.
const walletCancelMessage = /^transaction (was )?cancell?ed\.?$/i

const getWalletCancelMessage = (e: any): string | undefined => {
  if (e instanceof BaseError) {
    return undefined
  }
  return [e.message, e.cause?.message].find(
    (message): message is string =>
      typeof message === 'string' && walletCancelMessage.test(message)
  )
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

  const walletCancel = getWalletCancelMessage(e)
  if (walletCancel) {
    return new TransactionError(
      LiFiErrorCode.TransactionCanceled,
      walletCancel,
      e
    )
  }

  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(e.message || ErrorMessage.UnknownError, e)
}
