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

// Some wallets report a Cancel on the sign prompt only with this text (an
// injected Unisat provider). The whole message must match, so a longer error
// that starts with these words does not count. The wallet sent nothing, so the
// error maps to SignatureRejected, as a user rejection does.
const walletCancelMessage = /^transaction (was )?cancell?ed\.?$/i

const getWalletCancelMessage = (e: any): string | undefined => {
  // The SDK's own errors keep their code, also as the cause of another error.
  if (e instanceof BaseError || e.cause instanceof BaseError) {
    return undefined
  }
  // bigmi wraps a wallet error as "Unknown Error", with the wallet error as
  // the cause. A wallet that rejects with a string gives a string cause. The
  // Ctrl connector puts the wallet text in the short message of a bigmi
  // error, which bigmi passes on unchanged.
  for (const message of [
    e.message,
    e.shortMessage,
    e.cause?.message,
    e.cause,
  ]) {
    if (
      typeof message === 'string' &&
      walletCancelMessage.test(message.trim())
    ) {
      return message.trim()
    }
  }
  return undefined
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
      LiFiErrorCode.SignatureRejected,
      walletCancel,
      e
    )
  }

  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(e.message || ErrorMessage.UnknownError, e)
}
