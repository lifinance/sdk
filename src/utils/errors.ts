import type { LiFiStep, Process } from '@lifi/types'
import { version } from '../version.js'

export enum ErrorName {
  RPCError = 'RPCError',
  ProviderError = 'ProviderError',
  ServerError = 'ServerError',
  TransactionError = 'TransactionError',
  ValidationError = 'ValidationError',
  BalanceError = 'BalanceError',
  NotFoundError = 'NotFoundError',
  UnknownError = 'UnknownError',
  SlippageError = 'SlippageError',
  HTTPError = 'HTTPError',
}
// TODO: identify specific http error codes
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

const isLiFiErrorCode = (error: Error) =>
  error instanceof LiFiBaseError &&
  !!Object.values(LiFiErrorCode).find((value) => value === error.code)

// TODO: what to do with the stack chain? Nice way to deal with that?
// Note: LiFiSDKError is used to wrapper and present errors at the top level
// Where oportunity allows we also add the step and the process relate to the error
export class LiFiSDKError extends Error {
  step?: LiFiStep
  process?: Process
  code: ErrorCode
  override name = 'LiFiSDKError'

  constructor(cause: Error, message?: string) {
    const errorMessage = `${message ? message : `[${cause.name}] ${cause.message}` || 'Unknown error occurred'}\nLiFi SDK version: ${version}`
    super(errorMessage)
    this.cause = cause
    this.code = isLiFiErrorCode(cause)
      ? (cause as LiFiBaseError).code
      : LiFiErrorCode.InternalError
  }
}

// Note: we use the LiFiBaseErrors to capture errors at specific points in the code
//  they can carry addition to help give those more context
export class LiFiBaseError extends Error {
  code: ErrorCode
  htmlMessage?: string

  constructor(
    name: ErrorName,
    code: number,
    message: string,
    htmlMessage?: string,
    cause?: Error
  ) {
    super(message)

    this.name = name
    this.code = code
    this.htmlMessage = htmlMessage
    this.cause = cause
  }
}

export const getRPCError = (
  code: LiFiErrorCode,
  message: string,
  htmlMessage?: string,
  cause?: Error
) => new LiFiBaseError(ErrorName.RPCError, code, message, htmlMessage, cause)

export const getProviderError = (
  code: LiFiErrorCode,
  message: string,
  htmlMessage?: string,
  cause?: Error
) =>
  new LiFiBaseError(ErrorName.ProviderError, code, message, htmlMessage, cause)

export const getTransactionError = (
  code: LiFiErrorCode,
  message: string,
  htmlMessage?: string,
  cause?: Error
) =>
  new LiFiBaseError(
    ErrorName.TransactionError,
    code,
    message,
    htmlMessage,
    cause
  )

export const getGenericUnknownError = (
  message: string,
  htmlMessage?: string,
  cause?: Error
) =>
  new LiFiBaseError(
    ErrorName.UnknownError,
    LiFiErrorCode.InternalError,
    message,
    htmlMessage,
    cause
  )

export const getBalanceError = (message: string, htmlMessage?: string) =>
  new LiFiBaseError(
    ErrorName.BalanceError,
    LiFiErrorCode.BalanceError,
    message,
    htmlMessage
  )

export const getServerError = (message: string) =>
  new LiFiBaseError(ErrorName.ServerError, LiFiErrorCode.InternalError, message)

export const getValidationError = (message: string) =>
  new LiFiBaseError(
    ErrorName.ValidationError,
    LiFiErrorCode.ValidationError,
    message
  )

export const getApiValidationError = (message: string) =>
  new LiFiSDKError(getValidationError(message))
