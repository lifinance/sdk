import type { LiFiStep } from '@lifi/types'
import type { Process } from '../core/types.js'
import { version } from '../version.js'
import type { BaseError } from './baseError.js'
import type { ErrorCode } from './constants.js'

// Note: SDKError is used to wrapper and present errors at the top level
// Where opportunity allows we also add the step and the process related to the error
export class SDKError extends Error {
  step?: LiFiStep
  process?: Process
  code: ErrorCode
  override name = 'SDKError'
  override cause: BaseError

  constructor(cause: BaseError, step?: LiFiStep, process?: Process) {
    const errorMessage = `${cause.message ? `[${cause.name}] ${cause.message}` : 'Unknown error occurred'}\nLI.FI SDK version: ${version}`
    super(errorMessage)
    this.name = 'SDKError'
    this.step = step
    this.process = process
    this.cause = cause
    this.stack = this.cause.stack
    this.code = cause.code
  }
}
