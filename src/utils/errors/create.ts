import { ErrorName, LiFiErrorCode } from './constants.js'
import { LiFiBaseError } from './baseError.js'
import { LiFiSDKError } from './SDKError.js'

// TODO: consider reverting this to classes

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
