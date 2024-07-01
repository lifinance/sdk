import type { ErrorCode, ErrorName } from './constants.js'

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
    if (this.cause) {
      this.stack = this.cause.stack
    }
  }
}
