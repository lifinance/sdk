enum ErrorType {
  RPCError = 'RPCError',
  ProviderError = 'ProviderError',
  ServerError = 'ServerError',
  TransactionError = 'TransactionError',
  ValidationError = 'ValidationError',
  NotFoundError = 'NotFoundError',
  UnknownError = 'UnknownError',
  SlippageError = 'SlippageError',
}

export enum LifiErrorCode {
  InternalError = 1000, // we can discuss which number field we want to use for our custom error codes.
  ValidationError = 1001,
  TransactionUnderpriced = 1002,
  TransactionFailed = 1003,
  Timeout = 1004,
  ProviderUnavailable = 1005,
  NotFound = 1006,
  ChainSwitchError = 1007,
  TransactionUnprepared = 1008,
  GasLimitError = 1009,
  SlippageNotMet = 1010,
  SlippageError = 1011,
}

export enum MetaMaskRPCErrorCode {
  invalidInput = -32000,
  resourceNotFound = -32001,
  resourceUnavailable = -32002,
  transactionRejected = -32003,
  methodNotSupported = -32004,
  limitExceeded = -32005,
  parse = -32700,
  invalidRequest = -32600,
  methodNotFound = -32601,
  invalidParams = -32602,
  internal = -32603,
}

export enum MetaMaskProviderErrorCode {
  userRejectedRequest = 4001,
  unauthorized = 4100,
  unsupportedMethod = 4200,
  disconnected = 4900,
  chainDisconnected = 4901,
}

export type ErrorCode =
  | LifiErrorCode
  | MetaMaskRPCErrorCode
  | MetaMaskProviderErrorCode

export class LifiError extends Error {
  code: ErrorCode
  htmlMessage?: string

  constructor(
    type: ErrorType,
    code: number,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(message)

    // Set the prototype explicitly: https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, LifiError.prototype)

    this.code = code

    // the name property is used by toString(). It is a string and we can't use our custom ErrorTypes, that's why we have to cast
    this.name = type.toString()

    this.htmlMessage = htmlMessage

    // passing a stack allows us to preserve the stack from errors that we caught and just want to transform in one of our custom errors
    if (stack) {
      this.stack = stack
    }
  }
}

export class RPCError extends LifiError {
  constructor(
    code: ErrorCode,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(ErrorType.RPCError, code, message, htmlMessage, stack)
  }
}

export class ProviderError extends LifiError {
  constructor(
    code: ErrorCode,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(ErrorType.ProviderError, code, message, htmlMessage, stack)
  }
}

export class ServerError extends LifiError {
  constructor(message: string, htmlMessage?: string, stack?: string) {
    super(
      ErrorType.ServerError,
      LifiErrorCode.InternalError,
      message,
      htmlMessage,
      stack
    )
  }
}

export class ValidationError extends LifiError {
  constructor(message: string, htmlMessage?: string, stack?: string) {
    super(
      ErrorType.ValidationError,
      LifiErrorCode.ValidationError,
      message,
      htmlMessage,
      stack
    )
  }
}

export class TransactionError extends LifiError {
  constructor(
    code: ErrorCode,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(ErrorType.TransactionError, code, message, htmlMessage, stack)
  }
}

export class SlippageError extends LifiError {
  constructor(message: string, htmlMessage?: string, stack?: string) {
    super(
      ErrorType.SlippageError,
      LifiErrorCode.SlippageError,
      message,
      htmlMessage,
      stack
    )
  }
}

export class NotFoundError extends LifiError {
  constructor(message: string, htmlMessage?: string, stack?: string) {
    super(
      ErrorType.NotFoundError,
      LifiErrorCode.NotFound,
      message,
      htmlMessage,
      stack
    )
  }
}

export class UnknownError extends LifiError {
  constructor(
    code: ErrorCode,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(ErrorType.UnknownError, code, message, htmlMessage, stack)
  }
}
