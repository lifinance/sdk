import { describe, expect, it } from 'vitest'
import { ErrorName, LiFiErrorCode } from './constants.js'
import { LiFiBaseError } from './baseError.js'
import { LiFiSDKError } from './SDKError.js'
import { version } from '../../version.js'
import { HTTPError } from './httpError.js'

const url = 'http://some.where'
const options = { method: 'POST' }
const responseBody = { message: 'Oops' }

describe('LiFiSDKError', () => {
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
          throw new LiFiSDKError(e)
        }
      }

      try {
        await testFunction()
      } catch (e: any) {
        expect((e as LiFiSDKError).stack).toBe((e as LiFiSDKError).cause.stack)
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
        throw new LiFiSDKError(httpError)
      }

      expect(() => testFunction()).toThrowError(
        `[HTTPError] [ValidationError] Request failed with status code 400 Bad Request\n        responseMessage: Oops\nLiFi SDK version: ${version}`
      )
    })
  })

  describe('when the cause is a base error', () => {
    it('should present the causing errors stack trace for base errors', () => {
      expect.assertions(1)

      const testFunction = () => {
        try {
          const baseError = new LiFiBaseError(
            ErrorName.ValidationError,
            LiFiErrorCode.ValidationError,
            'problem validating'
          )

          throw baseError
        } catch (e: any) {
          throw new LiFiSDKError(e)
        }
      }

      try {
        testFunction()
      } catch (e: any) {
        expect((e as LiFiSDKError).stack).toBe((e as LiFiSDKError).cause.stack)
      }
    })

    it('should present the causing errors stack trace for base errors own causing error', () => {
      expect.assertions(1)

      const causingError = () => {
        try {
          throw new Error('this was the root cause')
        } catch (e: any) {
          throw new LiFiBaseError(
            ErrorName.ValidationError,
            LiFiErrorCode.ValidationError,
            'problem validating',
            undefined,
            e
          )
        }
      }

      const testFunction = () => {
        try {
          causingError()
        } catch (e: any) {
          throw new LiFiSDKError(e)
        }
      }

      try {
        testFunction()
      } catch (e: any) {
        expect((e as LiFiSDKError).stack).toBe(
          ((e as LiFiSDKError).cause as LiFiSDKError).cause.stack
        )
      }
    })

    it('should feature the causing base error message as part of its own message', () => {
      const testFunction = () => {
        throw new LiFiSDKError(
          new LiFiBaseError(
            ErrorName.UnknownError,
            LiFiErrorCode.InternalError,
            'There was an error'
          )
        )
      }

      expect(() => testFunction()).toThrowError(
        `[UnknownError] There was an error\nLiFi SDK version: ${version}`
      )
    })

    it('should use a fail back error message if one is not defined on the base error', () => {
      const testFunction = () => {
        throw new LiFiSDKError(
          new LiFiBaseError(
            ErrorName.BalanceError,
            LiFiErrorCode.BalanceError,
            ''
          )
        )
      }

      expect(() => testFunction()).toThrowError(
        `Unknown error occurred\nLiFi SDK version: ${version}`
      )
    })

    it('should present the passed base error as the cause', () => {
      const baseError = new LiFiBaseError(
        ErrorName.UnknownError,
        LiFiErrorCode.InternalError,
        'There was an error'
      )
      const sdkError = new LiFiSDKError(baseError)

      expect(sdkError.cause).toBe(baseError)
    })
  })
})
