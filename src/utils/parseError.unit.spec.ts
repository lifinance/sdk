import { LifiErrorCodes } from './errors'
import {
  errorCodes as MetaMaskErrorCodes,
  getMessageFromCode,
} from 'eth-rpc-errors'
import { parseBackendError, parseWalletError } from './parseError'

describe('parseError', () => {
  describe('parseWalletError', () => {
    describe('when the error does not contain a code', () => {
      it('should return an UnknownError with the default message if no message is set', async () => {
        const parsedError = parseWalletError('Oops')

        expect(parsedError.message).toEqual('Unknown error occured')
        expect(parsedError.code).toEqual(LifiErrorCodes.internalError)
      })

      it('should return an UnknownError with the given message', async () => {
        const parsedError = parseWalletError({ message: 'Somethings fishy' })

        expect(parsedError.message).toEqual('Somethings fishy')
        expect(parsedError.code).toEqual(LifiErrorCodes.internalError)
      })
    })

    describe('when the error contains an unknown error code', () => {
      it('should return an UnknownError', async () => {
        const parsedError = parseWalletError({
          code: 1337,
          message: 'Somethings fishy',
        })

        expect(parsedError.message).toEqual('Somethings fishy')
        expect(parsedError.code).toEqual(LifiErrorCodes.internalError)
      })
    })

    describe('when the error contains a rpc error code', () => {
      it('should return a RPCError with the metamask error message', async () => {
        const parsedError = parseWalletError({
          code: MetaMaskErrorCodes.rpc.methodNotFound,
          message: 'Somethings fishy',
        })

        expect(parsedError.message).toEqual(
          getMessageFromCode(MetaMaskErrorCodes.rpc.methodNotFound)
        )
        expect(parsedError.code).toEqual(MetaMaskErrorCodes.rpc.methodNotFound)
      })

      it('should return a RPCError with a custom message if underpriced', async () => {
        const parsedError = parseWalletError({
          code: MetaMaskErrorCodes.rpc.internal,
          message: 'RPC called failed: transaction underpriced',
        })

        expect(parsedError.message).toEqual('Transaction is underpriced.')
        expect(parsedError.code).toEqual(LifiErrorCodes.transactionUnderpriced)
      })
    })

    describe('when the error contains a provider error code', () => {
      it('should return a ProviderError with the metamask error message', async () => {
        const parsedError = parseWalletError({
          code: MetaMaskErrorCodes.provider.unsupportedMethod,
          message: 'Somethings fishy',
        })

        expect(parsedError.message).toEqual(
          getMessageFromCode(MetaMaskErrorCodes.provider.unsupportedMethod)
        )
        expect(parsedError.code).toEqual(
          MetaMaskErrorCodes.provider.unsupportedMethod
        )
      })
    })
  })

  describe('parseBackendError', () => {
    describe("when the error doesn't contain a status", () => {
      it('should return a ServerError with a default messsage', async () => {
        const parsedError = parseBackendError('Oops')

        expect(parsedError.message).toEqual('Something went wrong')
        expect(parsedError.code).toEqual(LifiErrorCodes.internalError)
      })
    })

    describe('when the error contains a status', () => {
      describe('when the status is 400', () => {
        it('should return the error message if set', async () => {
          const parsedError = parseBackendError({
            response: { status: 400, data: { message: 'Oops' } },
          })

          expect(parsedError.message).toEqual('Oops')
          expect(parsedError.code).toEqual(LifiErrorCodes.validationError)
        })

        it('should return the axios statusText if message not set', async () => {
          const parsedError = parseBackendError({
            response: {
              status: 400,
              statusText: 'Request failed with statusCode 400',
            },
          })

          expect(parsedError.message).toEqual(
            'Request failed with statusCode 400'
          )
          expect(parsedError.code).toEqual(LifiErrorCodes.validationError)
        })
      })

      describe('when the status is 500', () => {
        it('should return the error message if set', async () => {
          const parsedError = parseBackendError({
            response: { status: 500, data: { message: 'Oops' } },
          })

          expect(parsedError.message).toEqual('Oops')
          expect(parsedError.code).toEqual(LifiErrorCodes.internalError)
        })

        it('should return the axios statusText if message not set', async () => {
          const parsedError = parseBackendError({
            response: {
              status: 500,
              statusText: 'Request failed with statusCode 500',
            },
          })

          expect(parsedError.message).toEqual(
            'Request failed with statusCode 500'
          )
          expect(parsedError.code).toEqual(LifiErrorCodes.internalError)
        })
      })
    })
  })
})
