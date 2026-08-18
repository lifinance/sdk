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

export const parseStellarErrors = async (
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
  // `callStellarRpcsWithRetry` collapses every rejection into an AggregateError,
  // whose own message says nothing useful. Classify from the error it hides,
  // preferring one this package already classified.
  if (e instanceof AggregateError && e.errors.length) {
    const classified = e.errors.find(
      (error: unknown) => error instanceof BaseError
    )
    return handleSpecificErrors(classified ?? e.errors[0])
  }

  // A code this package set on purpose wins over message matching: an allowance
  // the SDK could not read is not an allowance the user has to grant.
  if (e instanceof BaseError) {
    return e
  }

  // Stellar Wallets Kit surfaces wallet rejections as messages rather than typed
  // errors, and the shape varies per wallet — match on the text, as Sui does.
  const message: string = typeof e === 'string' ? e : (e?.message ?? '')
  const normalized = message.toLowerCase()

  if (normalized.includes('reject') || normalized.includes('denied')) {
    return new TransactionError(LiFiErrorCode.SignatureRejected, message, e)
  }

  // The envelope's timebounds lapsed while the user was in their wallet. The
  // route needs a freshly built envelope, which resuming the route produces.
  if (normalized.includes('tx_too_late') || normalized.includes('txtoolate')) {
    return new TransactionError(
      LiFiErrorCode.TransactionExpired,
      'The Stellar transaction expired before it was submitted. Please request a new route to get a fresh transaction.',
      e
    )
  }

  // Another transaction from this account consumed the sequence number the
  // envelope was built against.
  if (normalized.includes('tx_bad_seq') || normalized.includes('txbadseq')) {
    return new TransactionError(
      LiFiErrorCode.TransactionConflict,
      'The Stellar account sequence number changed before the transaction was submitted. Please request a new route to get a fresh transaction.',
      e
    )
  }

  if (
    normalized.includes('tx_insufficient_balance') ||
    normalized.includes('txinsufficientbalance')
  ) {
    return new TransactionError(LiFiErrorCode.InsufficientFunds, message, e)
  }

  if (
    normalized.includes('tx_insufficient_fee') ||
    normalized.includes('txinsufficientfee')
  ) {
    return new TransactionError(
      LiFiErrorCode.TransactionUnderpriced,
      message,
      e
    )
  }

  if (normalized.includes('allowance')) {
    return new TransactionError(LiFiErrorCode.AllowanceRequired, message, e)
  }

  if (
    normalized.includes('simulation') ||
    normalized.includes('simulate') ||
    normalized.includes('hosterror')
  ) {
    return new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      message,
      e
    )
  }

  return new UnknownError(message || ErrorMessage.UnknownError, e)
}
