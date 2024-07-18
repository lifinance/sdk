import { ErrorName, LiFiErrorCode } from './constants.js'
import { BaseError } from './baseError.js'

export class RPCError extends BaseError {
  constructor(
    code: LiFiErrorCode,
    message: string,
    htmlMessage?: string,
    cause?: Error
  ) {
    super(ErrorName.RPCError, code, message, htmlMessage, cause)
  }
}

export class ProviderError extends BaseError {
  constructor(
    code: LiFiErrorCode,
    message: string,
    htmlMessage?: string,
    cause?: Error
  ) {
    super(ErrorName.ProviderError, code, message, htmlMessage, cause)
  }
}

export class TransactionError extends BaseError {
  constructor(
    code: LiFiErrorCode,
    message: string,
    htmlMessage?: string,
    cause?: Error
  ) {
    super(ErrorName.TransactionError, code, message, htmlMessage, cause)
  }
}

export class UnknownError extends BaseError {
  constructor(message: string, htmlMessage?: string, cause?: Error) {
    super(
      ErrorName.UnknownError,
      LiFiErrorCode.InternalError,
      message,
      htmlMessage,
      cause
    )
  }
}

export class BalanceError extends BaseError {
  constructor(message: string, htmlMessage?: string, cause?: Error) {
    super(
      ErrorName.BalanceError,
      LiFiErrorCode.BalanceError,
      message,
      htmlMessage,
      cause
    )
  }
}

export class ServerError extends BaseError {
  constructor(message: string) {
    super(ErrorName.ServerError, LiFiErrorCode.InternalError, message)
  }
}

export class ValidationError extends BaseError {
  constructor(message: string) {
    super(ErrorName.ValidationError, LiFiErrorCode.ValidationError, message)
  }
}
