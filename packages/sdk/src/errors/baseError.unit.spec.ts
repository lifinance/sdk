import { describe, expect, it } from 'vitest'
import { BaseError } from './baseError.js'
import { ErrorName, LiFiErrorCode } from './constants.js'

describe('baseError', () => {
  it('should set the stack to the same as the deep rooted cause', () => {
    const rootError = new Error()
    rootError.stack = 'root stack trace'

    const intermediateError = new Error()
    intermediateError.cause = rootError

    const errorChain = new BaseError(
      ErrorName.UnknownError,
      LiFiErrorCode.InternalError,
      'There was an error',
      intermediateError
    )

    expect(errorChain.stack).toBe(rootError.stack)
  })
})
