import type { LiFiStep, Process } from '@lifi/types'
import { TransactionError, UnknownError } from '../../utils/errors/errors.js'
import { SDKError } from '../../utils/errors/SDKError.js'
import { ErrorMessage, LiFiErrorCode } from '../../utils/errors/constants.js'
import { BaseError } from '../../utils/index.js'

export const parseEVMStepErrors = async (
  e: Error,
  step?: LiFiStep,
  process?: Process
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    e.process = e.process ?? process
    return e
  }

  let baseError

  baseError = handleViemErrors(e)

  if (e instanceof BaseError) {
    baseError = e
  }

  return new SDKError(
    baseError ??
      new UnknownError(e.message || ErrorMessage.UnknownError, undefined, e),
    step,
    process
  )
}

const handleViemErrors = (e: any) => {
  if (e.cause?.name === 'UserRejectedRequestError') {
    return new TransactionError(
      LiFiErrorCode.SignatureRejected,
      e.message,
      undefined,
      e
    )
  }
  return
}
