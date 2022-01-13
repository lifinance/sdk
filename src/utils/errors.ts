enum ErrorType {
  RPCError = 'RPCError',
  ProviderError = 'ProviderError',
  UnknownError = 'UnknownError',
  ServerError = 'ServerError',
  ValidationError = 'ValidationError',
}

export enum LifiErrorCodes {
  internalError = 1000, // we can discuss which number field we want to use for our custom error codes.
  validationError = 1001,
  transactionUnderpriced = 1002,
  transactionFailed = 1003,
}

enum MetaMaskRPCErrorCodes {
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

enum MetaMaskProviderErrorCodes {
  userRejectedRequest = 4001,
  unauthorized = 4100,
  unsupportedMethod = 4200,
  disconnected = 4900,
  chainDisconnected = 4901,
}

export type ErrorCodes =
  | LifiErrorCodes
  | MetaMaskRPCErrorCodes
  | MetaMaskProviderErrorCodes

export class LifiError extends Error {
  code: ErrorCodes

  constructor(type: ErrorType, code: number, message: string, stack?: string) {
    super(message)

    this.code = code

    // the name property is used by toString(). It is a string and we can't use our custom ErrorTypes, that's why we have to cast
    this.name = type.toString()

    // passing a stack allows us to preserve the stack from errors that we caught and just want to transform in one of our custom errors
    if (stack) {
      this.stack = stack
    }
  }
}

export class RPCError extends LifiError {
  constructor(code: ErrorCodes, message: string, stack?: string) {
    super(ErrorType.RPCError, code, message, stack)
  }
}

export class ProviderError extends LifiError {
  constructor(code: ErrorCodes, message: string, stack?: string) {
    super(ErrorType.ProviderError, code, message, stack)
  }
}

export class ServerError extends LifiError {
  constructor(message: string, stack?: string) {
    super(ErrorType.ServerError, LifiErrorCodes.internalError, message, stack)
  }
}

export class ValidationError extends LifiError {
  constructor(message: string, stack?: string) {
    super(
      ErrorType.ValidationError,
      LifiErrorCodes.validationError,
      message,
      stack
    )
  }
}

export class UnknownError extends LifiError {
  constructor(code: ErrorCodes, message: string, stack?: string) {
    super(ErrorType.UnknownError, code, message, stack)
  }
}
