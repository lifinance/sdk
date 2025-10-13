import { describe, expect, it } from 'vitest'
import { version } from '../version.js'
import { BaseError } from './baseError.js'
import { ErrorName, LiFiErrorCode } from './constants.js'
import { HTTPError } from './httpError.js'
import { SDKError } from './SDKError.js'

const url = 'http://some.where'
const options = { method: 'POST' }
const responseBody = { message: 'Oops' }

describe('SDKError', () => {
  describe('when the cause is a http error', () => {
    it('should present the causing errors stack trace for http errors', async () => {
      expect.assertions(1)

      const testFunction = async () => {
        try {
          const mockResponse = {
            status: 400,
            statusText: 'Bad Request',
            json: () => Promise.resolve(responseBody),
          } as Response

          const httpError = new HTTPError(mockResponse, url, options)

          await httpError.buildAdditionalDetails()

          throw httpError
        } catch (e: any) {
          throw new SDKError(e)
        }
      }

      try {
        await testFunction()
      } catch (e: any) {
        expect((e as SDKError).stack).toBe((e as SDKError).cause.stack)
      }
    })

    it('should feature the causing http error message as part of its own message', async () => {
      const mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve(responseBody),
      } as Response

      const httpError = new HTTPError(mockResponse, url, options)

      await httpError.buildAdditionalDetails()

      const testFunction = () => {
        throw new SDKError(httpError)
      }

      expect(() => testFunction()).toThrowError(
        `[HTTPError] [ValidationError] Request failed with status code 400 Bad Request. Oops\nLI.FI SDK version: ${version}`
      )
    })
  })

  describe('when the cause is a base error', () => {
    it('should present the causing errors stack trace for base errors', () => {
      expect.assertions(1)

      const testFunction = () => {
        try {
          const baseError = new BaseError(
            ErrorName.ValidationError,
            LiFiErrorCode.ValidationError,
            'problem validating'
          )

          throw baseError
        } catch (e: any) {
          throw new SDKError(e)
        }
      }

      try {
        testFunction()
      } catch (e: any) {
        expect((e as SDKError).stack).toBe((e as SDKError).cause.stack)
      }
    })

    it('should present the causing errors stack trace for base errors own causing error', () => {
      expect.assertions(1)

      const causingError = () => {
        try {
          throw new Error('this was the root cause')
        } catch (e: any) {
          throw new BaseError(
            ErrorName.ValidationError,
            LiFiErrorCode.ValidationError,
            'problem validating',
            e
          )
        }
      }

      const testFunction = () => {
        try {
          causingError()
        } catch (e: any) {
          throw new SDKError(e)
        }
      }

      try {
        testFunction()
      } catch (e: any) {
        expect((e as SDKError).stack).toBe(
          ((e as SDKError).cause as SDKError).cause.stack
        )
      }
    })

    it('should feature the causing base error message as part of its own message', () => {
      const testFunction = () => {
        throw new SDKError(
          new BaseError(
            ErrorName.UnknownError,
            LiFiErrorCode.InternalError,
            'There was an error'
          )
        )
      }

      expect(() => testFunction()).toThrowError(
        `[UnknownError] There was an error\nLI.FI SDK version: ${version}`
      )
    })

    it('should use a fail back error message if one is not defined on the base error', () => {
      const testFunction = () => {
        throw new SDKError(
          new BaseError(ErrorName.BalanceError, LiFiErrorCode.BalanceError, '')
        )
      }

      expect(() => testFunction()).toThrowError(
        `Unknown error occurred\nLI.FI SDK version: ${version}`
      )
    })

    it('should present the passed base error as the cause', () => {
      const baseError = new BaseError(
        ErrorName.UnknownError,
        LiFiErrorCode.InternalError,
        'There was an error'
      )
      const sdkError = new SDKError(baseError)

      expect(sdkError.cause).toBe(baseError)
    })
  })
})
