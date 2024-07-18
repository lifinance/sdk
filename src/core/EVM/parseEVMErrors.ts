import { type LiFiStep, type Process } from '@lifi/types'
import { TransactionError, UnknownError } from '../../errors/errors.js'
import { SDKError } from '../../errors/SDKError.js'
import { ErrorMessage, LiFiErrorCode } from '../../errors/constants.js'
import { BaseError } from '../../utils/index.js'
import { fetchTxErrorDetails } from '../../helpers.js'

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
  if (e.cause?.name === 'UserRejectedRequestError') {
    return new TransactionError(
      LiFiErrorCode.SignatureRejected,
      e.message,
      undefined,
      e
    )
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
        undefined,
        e
      )
    }
  }

  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(e.message || ErrorMessage.UnknownError, undefined, e)
}
