import { LiFiBaseError } from './baseError.js'
import { type ErrorCode, LiFiErrorCode } from './constants.js'
import type { LiFiStep, Process } from '@lifi/types'
import { version } from '../../version.js'

const isLiFiErrorCode = (error: Error) =>
  error instanceof LiFiBaseError &&
  !!Object.values(LiFiErrorCode).find((value) => value === error.code)

// TODO: what to do with the stack chain? Nice way to deal with that?
// Note: LiFiSDKError is used to wrapper and present errors at the top level
// Where opportunity allows we also add the step and the process related to the error
export class LiFiSDKError extends Error {
  step?: LiFiStep
  process?: Process
  code: ErrorCode
  override name = 'LiFiSDKError'
  override cause: LiFiBaseError

  constructor(cause: LiFiBaseError, step?: LiFiStep, process?: Process) {
    const errorMessage = `${cause.message ? `[${cause.name}] ${cause.message}` : 'Unknown error occurred'}\nLiFi SDK version: ${version}`
    super(errorMessage)
    this.step = step
    this.process = process
    this.cause = cause
    this.stack = this.cause.stack
    this.code = isLiFiErrorCode(cause)
      ? (cause as LiFiBaseError).code
      : LiFiErrorCode.InternalError
  }
}
