export enum ErrorType {
  RPCError = 'RPCError',
  ProviderError = 'ProviderError',
  ServerError = 'ServerError',
  TransactionError = 'TransactionError',
  ValidationError = 'ValidationError',
  NotFoundError = 'NotFoundError',
  UnknownError = 'UnknownError',
  SlippageError = 'SlippageError',
  HTTPError = 'HTTPError',
}

export enum LiFiErrorCode {
  InternalError = 1000,
  ValidationError = 1001,
  TransactionUnderpriced = 1002,
  TransactionFailed = 1003,
  Timeout = 1004,
  ProviderUnavailable = 1005,
  NotFound = 1006,
  ChainSwitchError = 1007,
  TransactionUnprepared = 1008,
  GasLimitError = 1009,
  TransactionCanceled = 1010,
  SlippageError = 1011,
  SignatureRejected = 1012,
  BalanceError = 1013,
  AllowanceRequired = 1014,
  InsufficientFunds = 1015,
  ExchangeRateUpdateCanceled = 1016,
  WalletChangedDuringExecution = 1017,
}

export enum EthersErrorType {
  ActionRejected = 'ACTION_REJECTED',
  CallExecption = 'CALL_EXCEPTION',
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
}

export enum EthersErrorMessage {
  ERC20Allowance = 'ERC20: transfer amount exceeds allowance',
  LowGas = 'intrinsic gas too low',
  OutOfGas = 'out of gas',
  Underpriced = 'underpriced',
  LowReplacementFee = 'replacement fee too low',
}

export enum ErrorMessage {
  UnknownError = 'Unknown error occurred.',
  SlippageError = 'The slippage is larger than the defined threshold. Please request a new route to get a fresh quote.',
  GasLimitLow = 'Gas limit is too low.',
  TransactionUnderpriced = 'Transaction is underpriced.',
  Default = 'Something went wrong.',
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
  | LiFiErrorCode
  | MetaMaskRPCErrorCode
  | MetaMaskProviderErrorCode

export class LiFiError extends Error {
  code: ErrorCode
  htmlMessage?: string

  constructor(
    name: ErrorType,
    code: number,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(message)

    this.name = name
    this.code = code
    this.htmlMessage = htmlMessage

    if (stack) {
      this.stack = stack
    }
  }
}

export class RPCError extends LiFiError {
  constructor(
    code: ErrorCode,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(ErrorType.RPCError, code, message, htmlMessage, stack)
  }
}

export class ProviderError extends LiFiError {
  constructor(
    code: ErrorCode,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(ErrorType.ProviderError, code, message, htmlMessage, stack)
  }
}

export class ServerError extends LiFiError {
  constructor(message: string, htmlMessage?: string, stack?: string) {
    super(
      ErrorType.ServerError,
      LiFiErrorCode.InternalError,
      message,
      htmlMessage,
      stack
    )
  }
}

export class ValidationError extends LiFiError {
  constructor(message: string, htmlMessage?: string, stack?: string) {
    super(
      ErrorType.ValidationError,
      LiFiErrorCode.ValidationError,
      message,
      htmlMessage,
      stack
    )
  }
}

export class TransactionError extends LiFiError {
  constructor(
    code: ErrorCode,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(ErrorType.TransactionError, code, message, htmlMessage, stack)
  }
}

export class SlippageError extends LiFiError {
  constructor(message: string, htmlMessage?: string, stack?: string) {
    super(
      ErrorType.SlippageError,
      LiFiErrorCode.SlippageError,
      message,
      htmlMessage,
      stack
    )
  }
}

export class BalanceError extends LiFiError {
  constructor(message: string, htmlMessage?: string, stack?: string) {
    super(
      ErrorType.ValidationError,
      LiFiErrorCode.BalanceError,
      message,
      htmlMessage,
      stack
    )
  }
}

export class NotFoundError extends LiFiError {
  constructor(message: string, htmlMessage?: string, stack?: string) {
    super(
      ErrorType.NotFoundError,
      LiFiErrorCode.NotFound,
      message,
      htmlMessage,
      stack
    )
  }
}

export class UnknownError extends LiFiError {
  constructor(
    code: ErrorCode,
    message: string,
    htmlMessage?: string,
    stack?: string
  ) {
    super(ErrorType.UnknownError, code, message, htmlMessage, stack)
  }
}
