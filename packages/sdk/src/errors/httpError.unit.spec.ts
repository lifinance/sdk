import { describe, expect, it } from 'vitest'
import { ErrorName, LiFiErrorCode } from './constants.js'
import { HTTPError } from './httpError.js'

const url = 'http://some.where'
const options = { method: 'POST' }
const responseBody = { message: 'Oops' }

describe('HTTPError', () => {
  it.each([
    [
      'when status code is 400',
      options,
      400,
      'Bad Request',
      {
        initialMessage: 'Request failed with status code 400 Bad Request',
        type: ErrorName.ValidationError,
        code: LiFiErrorCode.ValidationError,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        builtMessage:
          '[ValidationError] Request failed with status code 400 Bad Request. Oops',
      },
    ],
    [
      'when status code is 404',
      options,
      404,
      'Not Found',
      {
        initialMessage: 'Request failed with status code 404 Not Found',
        type: ErrorName.NotFoundError,
        code: LiFiErrorCode.NotFound,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        builtMessage:
          '[NotFoundError] Request failed with status code 404 Not Found. Oops',
      },
    ],
    [
      'when status code is 409',
      options,
      409,
      'Conflict',
      {
        initialMessage:
          'Request failed with status code 409 Conflict\nThe slippage is larger than the defined threshold. Please request a new route to get a fresh quote.',
        type: ErrorName.SlippageError,
        code: LiFiErrorCode.SlippageError,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        builtMessage:
          '[SlippageError] Request failed with status code 409 Conflict\nThe slippage is larger than the defined threshold. Please request a new route to get a fresh quote. Oops',
      },
    ],
    [
      'when status code is 500',
      options,
      500,
      'Internal Server Error',
      {
        initialMessage:
          'Request failed with status code 500 Internal Server Error',
        type: ErrorName.ServerError,
        code: LiFiErrorCode.InternalError,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        builtMessage:
          '[ServerError] Request failed with status code 500 Internal Server Error. Oops',
      },
    ],
    [
      'when status code is undefined',
      options,
      undefined,
      '',
      {
        initialMessage: 'Request failed with an unknown error',
        type: ErrorName.ServerError,
        code: LiFiErrorCode.InternalError,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        builtMessage:
          '[ServerError] Request failed with an unknown error. Oops',
      },
    ],
    [
      'when there is a problem processing the body',
      options,
      400,
      'Bad Request',
      {
        initialMessage: 'Request failed with status code 400 Bad Request',
        type: ErrorName.ValidationError,
        code: LiFiErrorCode.ValidationError,
        jsonFunc: () => Promise.reject(new Error('fail')),
        responseBody: undefined,
        builtMessage:
          '[ValidationError] Request failed with status code 400 Bad Request',
      },
    ],
  ])(
    'should present correctly %s',
    async (_, requestOptions, statusCode, statusText, expected) => {
      const mockResponse = {
        status: statusCode,
        statusText,
        json: expected.jsonFunc,
      } as Response

      const error = new HTTPError(mockResponse, url, requestOptions)

      expect(error.status).toEqual(statusCode)
      expect(error.message).toEqual(expected.initialMessage)
      expect(error.url).toEqual(url)
      expect(error.fetchOptions).toEqual(requestOptions)

      expect(error.type).toEqual(expected.type)
      expect(error.code).toEqual(expected.code)

      await error.buildAdditionalDetails()

      expect(error.responseBody).toEqual(expected.responseBody)
      expect(error.message).toEqual(expected.builtMessage)
    }
  )
})
