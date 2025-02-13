import type { LiFiStep } from '@lifi/types'
import { SDKError } from '../../errors/SDKError.js'
import { BaseError } from '../../errors/baseError.js'
import { ErrorMessage, LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError, UnknownError } from '../../errors/errors.js'
import { fetchTxErrorDetails } from '../../utils/fetchTxErrorDetails.js'
import type { Process } from '../types.js'

export const parseEVMErrors = async (
  e: Error,
  step?: LiFiStep,
  process?: Process
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    e.process = e.process ?? process
    return e
  }

  const baseError = await handleSpecificErrors(e, step, process)

  return new SDKError(baseError, step, process)
}

const handleSpecificErrors = async (
  e: any,
  step?: LiFiStep,
  process?: Process
) => {
  if (
    e.name === 'UserRejectedRequestError' ||
    e.cause?.name === 'UserRejectedRequestError'
  ) {
    return new TransactionError(LiFiErrorCode.SignatureRejected, e.message, e)
  }
  // Safe Wallet via WalletConnect returns -32000 code when user rejects the signature
  // {
  //   code: -32000,
  //   message: 'User rejected transaction',
  // }
  if (e.cause?.code === -32000) {
    return new TransactionError(LiFiErrorCode.SignatureRejected, e.message, e)
  }

  if (
    step &&
    process?.txHash &&
    e.code === LiFiErrorCode.TransactionFailed &&
    e.message === ErrorMessage.TransactionReverted
  ) {
    const response = await fetchTxErrorDetails(
      process.txHash,
      step.action.fromChainId
    )

    const errorMessage = response?.error_message

    if (errorMessage?.toLowerCase().includes('out of gas')) {
      return new TransactionError(
        LiFiErrorCode.GasLimitError,
        ErrorMessage.GasLimitLow,
        e
      )
    }
  }

  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(e.message || ErrorMessage.UnknownError, e)
}
