import type { ErrorCode, ErrorName } from './constants.js'
import { getRootCause } from './utils/rootCause.js'

// Note: we use the LiFiBaseErrors to capture errors at specific points in the code
//  they can carry addition to help give more context
export class LiFiBaseError extends Error {
  code: ErrorCode
  htmlMessage?: string
  override cause?: Error

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

    const rootCause = getRootCause(this.cause)
    if (rootCause && rootCause.stack) {
      this.stack = rootCause.stack
    }
  }
}
