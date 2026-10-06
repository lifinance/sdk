import type { ExecuteStepRetryParams } from '../types/core.js'
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

export interface TransactionErrorOptions {
  /**
   * The chain gave a definite answer about the transaction (reverted, dropped,
   * cancelled or replaced). The step executor then flags the failed action
   * with `txFinal`, so a restart signs a new transaction.
   */
  final?: boolean
}

export class TransactionError extends BaseError {
  readonly final: boolean

  constructor(
    code: LiFiErrorCode,
    message: string,
    cause?: Error,
    options?: TransactionErrorOptions
  ) {
    super(ErrorName.TransactionError, code, message, cause)
    this.final = options?.final ?? false
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

/**
 * Thrown by a step executor when executeStep should be retried with the given params
 * (e.g. wallet rejected 7702 upgrade → retry with atomicityNotReady).
 * The execution layer catches this and retries executeStep(client, step, retryParams),
 * unless the route was stopped or the step has an open transaction.
 */
export class ExecuteStepRetryError extends BaseError {
  readonly retryParams: ExecuteStepRetryParams

  constructor(
    message: string,
    retryParams: ExecuteStepRetryParams,
    cause?: Error
  ) {
    super(
      ErrorName.ExecuteStepRetryError,
      LiFiErrorCode.InternalError,
      message,
      cause
    )
    this.retryParams = retryParams
  }
}
