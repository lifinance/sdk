import { ErrorName, LiFiErrorCode } from './constants.js'
import { LiFiBaseError } from './baseError.js'

export class RPCError extends LiFiBaseError {
  constructor(
    code: LiFiErrorCode,
    message: string,
    htmlMessage?: string,
    cause?: Error
  ) {
    super(ErrorName.RPCError, code, message, htmlMessage, cause)
  }
}

export class ProviderError extends LiFiBaseError {
  constructor(
    code: LiFiErrorCode,
    message: string,
    htmlMessage?: string,
    cause?: Error
  ) {
    super(ErrorName.ProviderError, code, message, htmlMessage, cause)
  }
}

export class TransactionError extends LiFiBaseError {
  constructor(
    code: LiFiErrorCode,
    message: string,
    htmlMessage?: string,
    cause?: Error
  ) {
    super(ErrorName.ProviderError, code, message, htmlMessage, cause)
  }
}

export class UnknownError extends LiFiBaseError {
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

export class BalanceError extends LiFiBaseError {
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

export class ServerError extends LiFiBaseError {
  constructor(message: string) {
    super(ErrorName.ServerError, LiFiErrorCode.InternalError, message)
  }
}

export class ValidationError extends LiFiBaseError {
  constructor(message: string) {
    super(ErrorName.ValidationError, LiFiErrorCode.ValidationError, message)
  }
}
