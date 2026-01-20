import type { LiFiStepExtended, TransactionType } from '../types/core.js'
import { version } from '../version.js'
import type { BaseError } from './baseError.js'
import type { ErrorCode } from './constants.js'

// Note: SDKError is used to wrapper and present errors at the top level
// Where opportunity allows we also add the step related to the error
export class SDKError extends Error {
  step?: LiFiStepExtended
  type?: TransactionType
  code: ErrorCode
  override name = 'SDKError'
  override cause: BaseError

  constructor(
    cause: BaseError,
    step?: LiFiStepExtended,
    type?: TransactionType
  ) {
    const errorMessage = `${cause.message ? `[${cause.name}] ${cause.message}` : 'Unknown error occurred'}\nLI.FI SDK version: ${version}`
    super(errorMessage)
    this.name = 'SDKError'
    this.step = step
    this.type = type
    this.cause = cause
    this.stack = this.cause.stack
    this.code = cause.code
  }
}
