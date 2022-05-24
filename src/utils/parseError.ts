import { Process, Step } from '@lifinance/types'
import {
  errorCodes as MetaMaskErrorCodes,
  getMessageFromCode,
} from 'eth-rpc-errors'
import ChainsService from '../services/ChainsService'
import {
  LifiError,
  LifiErrorCode,
  NotFoundError,
  ProviderError,
  RPCError,
  ServerError,
  TransactionError,
  UnknownError,
  ValidationError,
} from './errors'
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

export const getTransactionNotSentMessage = async (
  step?: Step,
  process?: Process
): Promise<string> => {
  let transactionNotSend =
    'Transaction was not sent, your funds are still in your wallet'

  // add information about funds if available
  if (step) {
    const chainService = ChainsService.getInstance()
    const chain = await chainService.getChainById(step.action.fromChainId)

    transactionNotSend += ` (${formatTokenAmountOnly(
      step.action.fromToken,
      step.action.fromAmount
    )} ${step.action.fromToken.symbol} on ${chain.name})`
  }

  transactionNotSend +=
    ", please retry.<br/>If it still doesn't work, it is safe to delete this transfer and start a new one."

  // add transaction explorer link if available
  transactionNotSend +=
    process && process.txLink
      ? `<br>You can check the failed transaction&nbsp;<a href="${process.txLink}" target="_blank" rel="nofollow noreferrer">here</a>.`
      : ''

  return transactionNotSend
}

export const getSlippageNotMetMessage = (step: Step) => {
  const { slippage } = step.action
  return `Transaction was not sent, your funds are still in your wallet.
  The updated quote for the current transaction does not meet your set slippage of ${
    slippage * 100
  }%.`
}

export const getTransactionFailedMessage = (process: Process): string => {
  return process.txLink
    ? `Please check the&nbsp;<a href="${process.txLink}" target="_blank" rel="nofollow noreferrer">block explorer</a> for more information.`
    : ''
}

export const parseError = async (
  e: any,
  step?: Step,
  process?: Process
): Promise<LifiError> => {
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
            LifiErrorCode.TransactionUnderpriced,
            'Transaction is underpriced.',
            await getTransactionNotSentMessage(step, process),
            e.stack
          )
        }

        return new RPCError(
          e.code,
          getMessageFromCode(e.code),
          await getTransactionNotSentMessage(step, process),
          e.stack
        )
      }

      // provider errors
      if (Object.values(MetaMaskErrorCodes.provider).includes(e.code)) {
        return new ProviderError(
          e.code,
          getMessageFromCode(e.code),
          await getTransactionNotSentMessage(step, process),
          e.stack
        )
      }
    }

    if (e.code === 'CALL_EXCEPTION') {
      return new ProviderError(
        LifiErrorCode.TransactionFailed,
        e.reason,
        await getTransactionNotSentMessage(step, process),
        e.stack
      )
    }

    if (e.Code === LifiErrorCode.TransactionUnprepared) {
      return new TransactionError(
        LifiErrorCode.TransactionUnprepared,
        e.message,
        await getTransactionNotSentMessage(step, process),
        e.stack
      )
    }
  }

  return new UnknownError(
    LifiErrorCode.InternalError,
    e.message || 'Unknown error occurred.',
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

  if (e.response?.status === 404) {
    return new NotFoundError(
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

  return new ServerError('Something went wrong.', undefined, e.stack)
}
