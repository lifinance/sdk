import {
  BaseError,
  ErrorMessage,
  type ExecutionAction,
  LiFiErrorCode,
  type LiFiStep,
  ProviderError,
  SDKError,
  TransactionError,
  UnknownError,
} from '@lifi/sdk'
import {
  WalletDisconnectedError,
  WalletNotFoundError,
  WalletNotSelectedError,
  WalletSignTransactionError,
  WalletWindowClosedError,
} from '@tronweb3/tronwallet-abstract-adapter'

// "BANDWITH" is the Tron protocol's own misspelling
const isBandwidthError = (message?: string): boolean =>
  !!message?.includes('BANDWITH_ERROR')

export const parseTronErrors = async (
  e: Error,
  step?: LiFiStep,
  action?: ExecutionAction
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    if (isBandwidthError(e.message)) {
      const baseError = new TransactionError(
        LiFiErrorCode.InsufficientFunds,
        'Insufficient TRX for network bandwidth. The account needs more TRX to cover transaction fees.',
        e
      )
      return new SDKError(baseError, step ?? e.step, action ?? e.action)
    }
    e.step = e.step ?? step
    e.action = e.action ?? action
    return e
  }

  const baseError = handleSpecificErrors(e)

  return new SDKError(baseError, step, action)
}

const handleSpecificErrors = (e: unknown): BaseError => {
  const message: string = typeof e === 'string' ? e : (e instanceof Error ? e.message : '')
  const cause: Error | undefined = e instanceof Error ? e : undefined

  if (
    e instanceof WalletSignTransactionError ||
    e instanceof WalletWindowClosedError
  ) {
    return new TransactionError(LiFiErrorCode.SignatureRejected, message, e)
  }

  if (e instanceof WalletNotFoundError || e instanceof WalletNotSelectedError) {
    return new ProviderError(LiFiErrorCode.ProviderUnavailable, message, e)
  }

  if (e instanceof WalletDisconnectedError) {
    return new TransactionError(
      LiFiErrorCode.WalletChangedDuringExecution,
      message,
      e
    )
  }

  // TronWeb trx.sign() validation errors
  if (
    message === 'Invalid transaction provided' ||
    message === 'Invalid transaction' ||
    message === 'Transaction is not signed'
  ) {
    return new TransactionError(LiFiErrorCode.TransactionUnprepared, message, cause)
  }

  if (message === 'Transaction is already signed') {
    return new TransactionError(LiFiErrorCode.TransactionFailed, message, cause)
  }

  if (message === 'Private key does not match address in transaction') {
    return new TransactionError(
      LiFiErrorCode.WalletChangedDuringExecution,
      message,
      cause
    )
  }

  if (isBandwidthError(message)) {
    return new TransactionError(
      LiFiErrorCode.InsufficientFunds,
      'Insufficient TRX for network bandwidth. The account needs more TRX to cover transaction fees.',
      cause
    )
  }

  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(message || ErrorMessage.UnknownError, cause)
}
