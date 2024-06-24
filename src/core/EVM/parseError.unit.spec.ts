import {
  errorCodes as MetaMaskErrorCodes,
  getMessageFromCode,
} from 'eth-rpc-errors'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildStepObject } from '../../../tests/fixtures.js'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { LiFiErrorCode } from '../../utils/errors.js'
import { parseError } from './parseError.js'

beforeAll(setupTestEnvironment)

describe('parseError', () => {
  describe('parseWalletError', () => {
    describe('when the error does not contain a code', () => {
      it('should return an UnknownError with the default message if no message is set', async () => {
        const parsedError = await parseError('Oops')

        expect(parsedError.message).toEqual('Unknown error occurred.')
        expect(parsedError.code).toEqual(LiFiErrorCode.InternalError)
      })

      it('should return an UnknownError with the given message', async () => {
        const parsedError = await parseError({
          message: 'Somethings fishy',
        })

        expect(parsedError.message).toEqual('Somethings fishy')
        expect(parsedError.code).toEqual(LiFiErrorCode.InternalError)
      })
    })

    describe('when the error contains an unknown error code', () => {
      it('should return an UnknownError', async () => {
        const parsedError = await parseError({
          code: 1337,
          message: 'Somethings fishy',
        })

        expect(parsedError.message).toEqual('Somethings fishy')
        expect(parsedError.code).toEqual(LiFiErrorCode.InternalError)
      })
    })

    // TODO: revisit
    describe.skip('when the error contains a rpc error code', () => {
      it('should return a RPCError with the metamask error message', async () => {
        const parsedError = await parseError({
          code: MetaMaskErrorCodes.rpc.methodNotFound,
          message: 'Somethings fishy',
        })

        expect(parsedError.message).toEqual(
          getMessageFromCode(MetaMaskErrorCodes.rpc.methodNotFound)
        )
        expect(parsedError.code).toEqual(MetaMaskErrorCodes.rpc.methodNotFound)
      })

      it('should return a RPCError with a custom message if underpriced', async () => {
        const parsedError = await parseError({
          code: MetaMaskErrorCodes.rpc.internal,
          message: 'RPC called failed: transaction underpriced',
        })

        expect(parsedError.message).toEqual('Transaction is underpriced.')
        expect(parsedError.code).toEqual(LiFiErrorCode.TransactionUnderpriced)
      })
    })

    describe('when the error contains a provider error code', () => {
      it('should return a ProviderError with the metamask error message', async () => {
        const parsedError = await parseError({
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

    // TODO: revisit
    describe.skip('when no step is passed to the parser', () => {
      it('should return a default htmlMessage', async () => {
        const parsedError = await parseError({
          code: MetaMaskErrorCodes.rpc.methodNotFound,
          message: 'Somethings fishy',
        })

        expect(parsedError.htmlMessage).toEqual(
          // eslint-disable-next-line max-len
          "Transaction was not sent, your funds are still in your wallet, please retry.<br/>If it still doesn't work, it is safe to delete this transfer and start a new one."
        )
      })
    })

    // TODO: revisit
    describe.skip('when a step is passed to the parser', () => {
      it('should include the token information in the htmlMessage', async () => {
        const parsedError = await parseError(
          {
            code: MetaMaskErrorCodes.rpc.methodNotFound,
            message: 'Somethings fishy',
          },
          buildStepObject({})
        )

        expect(parsedError.htmlMessage).toEqual(
          // eslint-disable-next-line max-len
          "Transaction was not sent, your funds are still in your wallet (1.5 USDC on Polygon), please retry.<br/>If it still doesn't work, it is safe to delete this transfer and start a new one."
        )
      })
    })

    // TODO: revisit
    describe.skip('when a process is passed to the parser', () => {
      it('should include the explorer link in the htmlMessage', async () => {
        const step = buildStepObject({ includingExecution: true })
        const parsedError = await parseError(
          {
            code: MetaMaskErrorCodes.rpc.methodNotFound,
            message: 'Somethings fishy',
          },
          step,
          step.execution?.process[0]
        )

        expect(parsedError.htmlMessage).toEqual(
          // eslint-disable-next-line max-len
          'Transaction was not sent, your funds are still in your wallet (1.5 USDC on Polygon), please retry.<br/>If it still doesn\'t work, it is safe to delete this transfer and start a new one.<br>You can check the failed transaction&nbsp;<a href="https://example.com" target="_blank" rel="nofollow noreferrer">here</a>.'
        )
      })
    })
  })
})
