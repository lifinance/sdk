import { describe, expect, it } from 'vitest'
import { SDKError } from '../SDKError.js'
import { BaseError } from '../baseError.js'
import { ErrorName, LiFiErrorCode } from '../constants.js'
import { HTTPError } from '../httpError.js'
import {
  getRootCauseBaseError,
  getRootCauseBaseErrorMessage,
} from './baseErrorRootCause.js'

const getErrorChain = () => {
  const NonLiFiErrorChain = new Error('non lifi error')
  NonLiFiErrorChain.cause = new Error('root cause')
  return new SDKError(
    new BaseError(
      ErrorName.ValidationError,
      LiFiErrorCode.ValidationError,
      'something happened',
      NonLiFiErrorChain
    )
  )
}

describe('getRootCauseBaseError', () => {
  it('should return the top level error when there is no root cause', () => {
    const error = new Error('top level')

    expect(getRootCauseBaseError(error).message).toEqual('top level')
  })

  it('should return the lowest BaseError in the cause chain', () => {
    const errorChain = getErrorChain()

    expect(getRootCauseBaseError(errorChain).message).toEqual(
      'something happened'
    )
  })
})

describe('getRootCauseBaseErrorMessage', () => {
  describe('when root cause is HTTP Error', () => {
    it('should return the HTTP response message if present', async () => {
      const mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        json: () =>
          Promise.resolve({ message: 'something went wrong on the server' }),
      } as Response

      const httpError = new HTTPError(mockResponse, 'http://some.where', {})

      await httpError.buildAdditionalDetails()

      const errorChain = new SDKError(httpError)

      expect(getRootCauseBaseErrorMessage(errorChain)).toEqual(
        'something went wrong on the server'
      )
    })

    it('should return the HTTP error message if response message not present', async () => {
      const mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({}),
      } as Response

      const httpError = new HTTPError(mockResponse, 'http://some.where', {})

      await httpError.buildAdditionalDetails()

      const errorChain = new SDKError(httpError)

      expect(getRootCauseBaseErrorMessage(errorChain)).toEqual(
        '[ValidationError] Request failed with status code 400 Bad Request'
      )
    })
  })

  describe('when root cause is base Error', () => {
    it('should return the BaseError message', () => {
      const errorChain = getErrorChain()

      expect(getRootCauseBaseErrorMessage(errorChain)).toEqual(
        'something happened'
      )
    })
  })
})
