import {
  errorCodes as MetaMaskErrorCodes,
  getMessageFromCode,
} from 'eth-rpc-errors'
import {
  LifiError,
  LifiErrorCodes,
  ProviderError,
  RPCError,
  ServerError,
  UnknownError,
  ValidationError,
} from './errors'
import { getChainById, Process, Step } from '@lifinance/types'
import { formatTokenAmountOnly } from './utils'

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

const getTransactionNotSentMessage = (
  step?: Step,
  process?: Process
): string => {
  let transactionNotSend =
    'Transaction was not sent, your funds are still in your wallet'

  // add information about funds if available
  transactionNotSend += step
    ? ` (${formatTokenAmountOnly(
        step.action.fromToken,
        step.action.fromAmount
      )} ${step.action.fromToken.symbol} on ${
        getChainById(step.action.fromChainId).name
      })`
    : ''

  transactionNotSend +=
    ", please retry.<br/>If it still doesn't work, it is safe to delete this transfer and start a new one."

  // add transaction explorer link if available
  transactionNotSend +=
    process && process.txLink
      ? `<br>You can check the failed transaction&nbsp;<a href="${process.txLink}" target="_blank" rel="nofollow noreferrer">here</a>.`
      : ''

  return transactionNotSend
}

export const parseWalletError = (
  e: any,
  step?: Step,
  process?: Process
): LifiError => {
  if (e.code) {
    // MetaMask errors have a numeric error code
    if (typeof e.code === 'number') {
      if (Object.values(MetaMaskErrorCodes.rpc).includes(e.code)) {
        // rpc errors
        // underpriced errors are sent as internal errors, so we need to parse the message manually
        if (
          e.code === MetaMaskErrorCodes.rpc.internal &&
          e.message &&
          e.message.includes('underpriced')
        ) {
          return new RPCError(
            LifiErrorCodes.transactionUnderpriced,
            'Transaction is underpriced.',
            getTransactionNotSentMessage(step, process),
            e.stack
          )
        }

        return new RPCError(
          e.code,
          getMessageFromCode(e.code),
          getTransactionNotSentMessage(step, process),
          e.stack
        )
      }

      // provider errors
      if (Object.values(MetaMaskErrorCodes.provider).includes(e.code)) {
        return new ProviderError(
          e.code,
          getMessageFromCode(e.code),
          getTransactionNotSentMessage(step, process),
          e.stack
        )
      }
    }

    if (e.code === 'CALL_EXCEPTION') {
      return new ProviderError(
        LifiErrorCodes.transactionFailed,
        e.reason,
        getTransactionNotSentMessage(step, process),
        e.stack
      )
    }
  }

  return new UnknownError(
    LifiErrorCodes.internalError,
    e.message || 'Unknown error occurred',
    undefined,
    e.stack
  )
}

export const parseBackendError = (e: any): LifiError => {
  if (e.response?.status === 400) {
    return new ValidationError(
      e.response?.data?.message || e.response?.statusText,
      undefined,
      e.stack
    )
  }

  if (e.response?.status === 500) {
    return new ServerError(
      e.response?.data?.message || e.response?.statusText,
      undefined,
      e.stack
    )
  }

  return new ServerError('Something went wrong', undefined, e.stack)
}
