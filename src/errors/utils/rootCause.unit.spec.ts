import { describe, expect, it } from 'vitest'
import { SDKError } from '../SDKError.js'
import { BaseError } from '../baseError.js'
import { ErrorName, LiFiErrorCode } from '../constants.js'
import { getRootCause } from './rootCause.js'

const getErrorChain = () => {
  const NonLiFiErrorChain = new Error('non lifi error')
  NonLiFiErrorChain.cause = new Error('root cause')
  return new SDKError(
    new BaseError(
      ErrorName.ValidationError,
      LiFiErrorCode.ValidationError,
      'something happened',
      undefined,
      NonLiFiErrorChain
    )
  )
}

describe('getRootCause', () => {
  it('should return the top level error when there is no root cause', () => {
    const error = new Error('top level')

    expect(getRootCause(error)!.message).toEqual('top level')
  })

  it('should return the root cause', () => {
    const errorChain = getErrorChain()

    expect(getRootCause(errorChain)!.message).toEqual('root cause')
  })

  it('should return undefined when passed undefined', () => {
    expect(getRootCause(undefined)).toBeUndefined()
  })
})
