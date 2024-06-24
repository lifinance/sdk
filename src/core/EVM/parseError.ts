import type { LiFiStep, Process } from '@lifi/types'
import {
  errorCodes as MetaMaskErrorCodes,
  getMessageFromCode,
} from 'eth-rpc-errors'
// import { fetchTxErrorDetails } from '../helpers.js'
import {
  ErrorMessage,
  EthersErrorMessage,
  getGenericUnknownError,
  getProviderError,
  getRPCError,
  getTransactionError,
  // EthersErrorType,
  LiFiBaseError,
  LiFiErrorCode,
  // MetaMaskProviderErrorCode,
} from '../../utils/errors.js'
import { getTransactionNotSentMessage } from '../../utils/getTransactionMessage.js'

/**
 * Available MetaMask error codes:
 *
 * export const errorCodes: ErrorCodes = {
     rpc: {
      invalidInput: -32000,
      resourceNotFound: -32001,
      resourceUnavailable: -32002,
      transactionRejected: -32003,
      methodNotSupported: -32004,
      limitExceeded: -32005,
      parse: -32700,
      invalidRequest: -32600,
      methodNotFound: -32601,
      invalidParams: -32602,
      internal: -32603,
    },
    provider: {
      userRejectedRequest: 4001,
      unauthorized: 4100,
      unsupportedMethod: 4200,
      disconnected: 4900,
      chainDisconnected: 4901,
    },
  };
 *
 * For more information about error codes supported by metamask check
 * https://github.com/MetaMask/eth-rpc-errors
 * https://eips.ethereum.org/EIPS/eip-1474#error-codes
 * https://eips.ethereum.org/EIPS/eip-1193#provider-errors
 */

export const parseError = async (
  e: any,
  step?: LiFiStep,
  process?: Process
): Promise<LiFiBaseError> => {
  if (e instanceof LiFiBaseError) {
    return e
  }

  const errorCode = e.code || e.cause?.code

  switch (errorCode) {
    // case EthersErrorType.CallExecption:
    //   const defaultErrorMessage = await getTransactionNotSentMessage(
    //     step,
    //     process
    //   )
    //   try {
    //     if (!step?.action.fromChainId) {
    //       throw new Error('fromChainId is not defined.')
    //     }
    //
    //     const response = await fetchTxErrorDetails(
    //       e.transactionHash,
    //       step?.action.fromChainId
    //     )
    //
    //     const errorMessage = response?.error_message ?? e.reason
    //
    //     const isAllowanceError =
    //       response?.error_message?.includes(
    //         EthersErrorMessage.ERC20Allowance
    //       ) || e.reason?.includes(EthersErrorMessage.ERC20Allowance)
    //
    //     if (isAllowanceError) {
    //       return new TransactionError(
    //         LiFiErrorCode.AllowanceRequired,
    //         e.reason,
    //         errorMessage,
    //         e.stack
    //       )
    //     }
    //
    //     // Error messages other than allowance error will be handled in catch block
    //     throw new Error(e)
    //   } catch (error) {
    //     return new ProviderError(
    //       LiFiErrorCode.TransactionFailed,
    //       e.reason,
    //       defaultErrorMessage,
    //       e.stack
    //     )
    //   }
    default: {
      if (errorCode && typeof errorCode === 'number') {
        if (Object.values(MetaMaskErrorCodes.rpc).includes(errorCode as any)) {
          // rpc errors
          // underpriced errors are sent as internal errors, so we need to parse the message manually
          // TODO: question: Still not sure what to replace this with
          if (
            errorCode === MetaMaskErrorCodes.rpc.internal &&
            (e.message?.includes(EthersErrorMessage.Underpriced) ||
              e.message?.includes(EthersErrorMessage.LowReplacementFee))
          ) {
            return getRPCError(
              LiFiErrorCode.TransactionUnderpriced,
              ErrorMessage.TransactionUnderpriced,
              await getTransactionNotSentMessage(step, process),
              e
            )
          }

          // TODO: replace with low gas errors - use viems IntrinsicGasTooLowError
          if (
            e.message?.includes(EthersErrorMessage.LowGas) ||
            e.message?.includes(EthersErrorMessage.OutOfGas)
          ) {
            return getTransactionError(
              LiFiErrorCode.GasLimitError,
              ErrorMessage.GasLimitLow,
              await getTransactionNotSentMessage(step, process),
              e
            )
          }

          // TODO: replace this with a generic error
          // return getRPCError(
          //   errorCode,
          //   getMessageFromCode(errorCode),
          //   await getTransactionNotSentMessage(step, process),
          //   e
          // )
        }

        // provider errors

        // TODO: replace this with a generic error
        if (
          Object.values(MetaMaskErrorCodes.provider).includes(errorCode as any)
        ) {
          return getProviderError(
            errorCode,
            getMessageFromCode(errorCode),
            await getTransactionNotSentMessage(step, process),
            e
          )
        }
      }

      return getGenericUnknownError(
        e.message || ErrorMessage.UnknownError,
        undefined,
        e
      )
    }
  }
}
