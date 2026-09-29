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

export const parseSolanaErrors = async (
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

// Same pattern as bigmi's `isUserRejection`. It is anchored on "user", so a
// refusal by a node or a host does not count as a rejection.
const userRejectionMessage =
  /(^|\W)user\W+(has\W+)?(rejected|denied|cancell?ed)|\b(rejected|denied|cancell?ed)\W+by\W+(the\W+)?user\b/i

/**
 * The SDK calls the Wallet Standard features directly, so a wallet's own error
 * arrives here unwrapped. Wallets report a rejection with the EIP-1193 code
 * 4001 or only with a message. An `AbortError` is not a rejection: nothing
 * says the user caused it. The SDK's own errors keep their code.
 */
const isUserRejection = (e: any): boolean =>
  !(e instanceof BaseError) &&
  (e.code === 4001 ||
    (typeof e.message === 'string' && userRejectionMessage.test(e.message)))

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

  // After the name checks: a known error keeps its code, even when its
  // message quotes program logs that look like a rejection.
  if (isUserRejection(e)) {
    return new TransactionError(LiFiErrorCode.SignatureRejected, e.message, e)
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
