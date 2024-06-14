import { describe, it, expect } from 'vitest'
import { HTTPError } from './httpError.js'
import { ErrorType, LiFiErrorCode } from './errors.js'

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
        type: ErrorType.ValidationError,
        code: LiFiErrorCode.ValidationError,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        htmlMessage: undefined,
        builtMessage: `[ValidationError] Request failed with status code 400 Bad Request
        responseMessage: Oops`,
      },
    ],
    [
      'when status code is 404',
      options,
      404,
      'Not Found',
      {
        initialMessage: 'Request failed with status code 404 Not Found',
        type: ErrorType.NotFoundError,
        code: LiFiErrorCode.NotFound,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        htmlMessage: undefined,
        builtMessage: `[NotFoundError] Request failed with status code 404 Not Found
        responseMessage: Oops`,
      },
    ],
    [
      'when status code is 409',
      options,
      409,
      'Conflict',
      {
        initialMessage: 'Request failed with status code 409 Conflict',
        type: ErrorType.SlippageError,
        code: LiFiErrorCode.SlippageError,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        htmlMessage:
          'The slippage is larger than the defined threshold. Please request a new route to get a fresh quote.',
        builtMessage: `[SlippageError] Request failed with status code 409 Conflict
        responseMessage: Oops`,
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
        type: ErrorType.ServerError,
        code: LiFiErrorCode.InternalError,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        htmlMessage: undefined,
        builtMessage: `[ServerError] Request failed with status code 500 Internal Server Error
        responseMessage: Oops`,
      },
    ],
    [
      'when status code is undefined',
      options,
      undefined,
      '',
      {
        initialMessage: 'Request failed with an unknown error',
        type: ErrorType.ServerError,
        code: LiFiErrorCode.InternalError,
        jsonFunc: () => Promise.resolve(responseBody),
        responseBody,
        htmlMessage: undefined,
        builtMessage: `[ServerError] Request failed with an unknown error
        responseMessage: Oops`,
      },
    ],
    [
      'when there is a problem processing the body',
      options,
      400,
      'Bad Request',
      {
        initialMessage: 'Request failed with status code 400 Bad Request',
        type: ErrorType.ValidationError,
        code: LiFiErrorCode.ValidationError,
        jsonFunc: () => Promise.reject(new Error('fail')),
        htmlMessage: undefined,
        responseBody: undefined,
        builtMessage: `[ValidationError] Request failed with status code 400 Bad Request`,
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
      if (expected.htmlMessage) {
        expect(error.htmlMessage).toEqual(expected.htmlMessage)
      }

      await error.buildAdditionalDetails()

      expect(error.responseBody).toEqual(expected.responseBody)
      expect(error.message).toEqual(expected.builtMessage)
    }
  )
})
