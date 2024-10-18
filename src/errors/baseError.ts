import type { ErrorCode, ErrorName } from './constants.js'
import { getRootCause } from './utils/rootCause.js'

// Note: we use the BaseErrors to capture errors at specific points in the code
// they can carry addition to help give more context
export class BaseError extends Error {
  code: ErrorCode
  override cause?: Error

  constructor(name: ErrorName, code: number, message: string, cause?: Error) {
    super(message)

    this.name = name
    this.code = code
    this.cause = cause

    const rootCause = getRootCause(this.cause)
    if (rootCause?.stack) {
      this.stack = rootCause.stack
    }
  }
}
