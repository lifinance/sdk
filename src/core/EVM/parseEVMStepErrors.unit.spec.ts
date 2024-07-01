import {
  errorCodes as MetaMaskErrorCodes,
  getMessageFromCode,
} from 'eth-rpc-errors'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildStepObject } from '../../../tests/fixtures.js'
import { setupTestEnvironment } from '../../../tests/setup.js'
import { LiFiErrorCode } from '../../utils/errors/constants.js'
import type { LiFiSDKError } from '../../utils/errors/SDKError.js'
import { parseEVMStepErrors } from './parseEVMStepErrors.js'

beforeAll(setupTestEnvironment)

describe('parseEVMStepErrors', () => {
  describe('parseWalletError', () => {
    describe('when the error does not contain a code', () => {
      it('should return an UnknownError with the default message if no message is set', async () => {
        const parsedError = await parseEVMStepErrors(new Error('Oops'))

        expect(parsedError.message).toEqual('Unknown error occurred.')
        expect(parsedError.code).toEqual(LiFiErrorCode.InternalError)
      })

      it('should return an UnknownError with the given message', async () => {
        const parsedError = await parseEVMStepErrors(
          new Error('Somethings fishy')
        )

        expect(parsedError.message).toEqual('Somethings fishy')
        expect(parsedError.code).toEqual(LiFiErrorCode.InternalError)
      })
    })

    describe('when the error contains an unknown error code', () => {
      it('should return an UnknownError', async () => {
        const error = new Error('Somethings fishy')
        ;(error as any).code = 1337
        const parsedError = await parseEVMStepErrors(error)

        expect(parsedError.message).toEqual('Somethings fishy')
        expect(parsedError.code).toEqual(LiFiErrorCode.InternalError)
      })
    })

    // TODO: revisit
    describe.skip('when the error contains a rpc error code', () => {
      it('should return a RPCError with the metamask error message', async () => {
        const error = new Error('Somethings fishy')
        ;(error as any).code = MetaMaskErrorCodes.rpc.methodNotFound

        const parsedError = await parseEVMStepErrors(error)

        expect(parsedError.message).toEqual(
          getMessageFromCode(MetaMaskErrorCodes.rpc.methodNotFound)
        )
        expect(parsedError.code).toEqual(MetaMaskErrorCodes.rpc.methodNotFound)
      })

      it('should return a RPCError with a custom message if underpriced', async () => {
        const error = new Error('RPC called failed: transaction underpriced')
        ;(error as any).code = MetaMaskErrorCodes.rpc.internal

        const parsedError = await parseEVMStepErrors(error)

        expect(parsedError.message).toEqual('Transaction is underpriced.')
        expect(parsedError.code).toEqual(LiFiErrorCode.TransactionUnderpriced)
      })
    })
    // TODO: review tests
    describe('when the error contains a provider error code', () => {
      it.only('should return a ProviderError with the metamask error message', async () => {
        const error = new Error('Somethings fishy')
        ;(error as any).code = MetaMaskErrorCodes.provider.unsupportedMethod

        const parsedError = await parseEVMStepErrors(error)

        expect((parsedError as LiFiSDKError).cause.message).toEqual(
          'Somethings fishy'
        )
        expect(parsedError.code).toEqual(LiFiErrorCode.InternalError)
      })
    })

    // TODO: revisit
    describe.skip('when no step is passed to the parser', () => {
      it('should return a default htmlMessage', async () => {
        const error = new Error('Somethings fishy')
        ;(error as any).code = MetaMaskErrorCodes.provider.unsupportedMethod

        const parsedError = await parseEVMStepErrors(error)

        expect(parsedError.cause.htmlMessage).toEqual(
          // eslint-disable-next-line max-len
          "Transaction was not sent, your funds are still in your wallet, please retry.<br/>If it still doesn't work, it is safe to delete this transfer and start a new one."
        )
      })
    })

    // TODO: revisit
    describe.skip('when a step is passed to the parser', () => {
      it('should include the token information in the htmlMessage', async () => {
        const error = new Error('Somethings fishy')
        ;(error as any).code = MetaMaskErrorCodes.rpc.methodNotFound

        const parsedError = await parseEVMStepErrors(error, buildStepObject({}))

        expect(parsedError.cause.htmlMessage).toEqual(
          // eslint-disable-next-line max-len
          "Transaction was not sent, your funds are still in your wallet (1.5 USDC on Polygon), please retry.<br/>If it still doesn't work, it is safe to delete this transfer and start a new one."
        )
      })
    })

    // TODO: revisit
    describe.skip('when a process is passed to the parser', () => {
      it('should include the explorer link in the htmlMessage', async () => {
        const error = new Error('Somethings fishy')
        ;(error as any).code = MetaMaskErrorCodes.rpc.methodNotFound
        const step = buildStepObject({ includingExecution: true })
        const parsedError = await parseEVMStepErrors(
          error,
          step,
          step.execution?.process[0]
        )

        expect(parsedError.cause.htmlMessage).toEqual(
          // eslint-disable-next-line max-len
          'Transaction was not sent, your funds are still in your wallet (1.5 USDC on Polygon), please retry.<br/>If it still doesn\'t work, it is safe to delete this transfer and start a new one.<br>You can check the failed transaction&nbsp;<a href="https://example.com" target="_blank" rel="nofollow noreferrer">here</a>.'
        )
      })
    })
  })
})
