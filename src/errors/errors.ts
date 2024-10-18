import { BaseError } from './baseError.js'
import { ErrorName, LiFiErrorCode } from './constants.js'

export class RPCError extends BaseError {
  constructor(code: LiFiErrorCode, message: string, cause?: Error) {
    super(ErrorName.RPCError, code, message, cause)
  }
}

export class ProviderError extends BaseError {
  constructor(code: LiFiErrorCode, message: string, cause?: Error) {
    super(ErrorName.ProviderError, code, message, cause)
  }
}

export class TransactionError extends BaseError {
  constructor(code: LiFiErrorCode, message: string, cause?: Error) {
    super(ErrorName.TransactionError, code, message, cause)
  }
}

export class UnknownError extends BaseError {
  constructor(message: string, cause?: Error) {
    super(ErrorName.UnknownError, LiFiErrorCode.InternalError, message, cause)
  }
}

export class BalanceError extends BaseError {
  constructor(message: string, cause?: Error) {
    super(ErrorName.BalanceError, LiFiErrorCode.BalanceError, message, cause)
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
