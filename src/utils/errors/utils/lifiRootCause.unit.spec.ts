import { describe, expect, it } from 'vitest'
import { SDKError } from '../SDKError.js'
import { BaseError } from '../baseError.js'
import { ErrorName, LiFiErrorCode } from '../constants.js'
import { getLiFiRootCause, getLiFiRootCauseMessage } from './lifiRootCause.js'
import { HTTPError } from '../httpError.js'

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

describe('getLiFiRootCause', () => {
  it('should return the top level error when there is no root cause', () => {
    const error = new Error('top level')

    expect(getLiFiRootCause(error).message).toEqual('top level')
  })

  it('should return the lowest LiFi error in the cause chain', () => {
    const errorChain = getErrorChain()

    expect(getLiFiRootCause(errorChain).message).toEqual('something happened')
  })
})

describe('getLiFiRootCauseMessage', () => {
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

      expect(getLiFiRootCauseMessage(errorChain)).toEqual(
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

      expect(getLiFiRootCauseMessage(errorChain)).toEqual(
        '[ValidationError] Request failed with status code 400 Bad Request'
      )
    })
  })

  describe('when root cause is base Error', () => {
    it('should return the LiFi error message', () => {
      const errorChain = getErrorChain()

      expect(getLiFiRootCauseMessage(errorChain)).toEqual('something happened')
    })
  })
})
