import type { LiFiStep } from '@lifi/types'
import { BaseError } from '../../errors/baseError.js'
import { ErrorMessage, LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError, UnknownError } from '../../errors/errors.js'
import { SDKError } from '../../errors/SDKError.js'
import type { Process } from '../types.js'

export const parseSuiErrors = async (
  e: Error,
  step?: LiFiStep,
  process?: Process
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    e.process = e.process ?? process
    return e
  }

  const baseError = handleSpecificErrors(e)

  return new SDKError(baseError, step, process)
}

const handleSpecificErrors = (e: any) => {
  const isRejection =
    typeof e === 'string'
      ? e.toLowerCase().includes('reject')
      : e.message?.toLowerCase().includes('reject')

  if (isRejection) {
    return new TransactionError(LiFiErrorCode.SignatureRejected, e.message, e)
  }

  if (
    e.message?.toLowerCase().includes('transaction') &&
    (e.message?.toLowerCase().includes('failed') ||
      e.message?.toLowerCase().includes('error'))
  ) {
    return new TransactionError(LiFiErrorCode.TransactionFailed, e.message, e)
  }

  if (e.message?.includes('simulate') || e.message?.includes('simulation')) {
    return new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      e.message,
      e
    )
  }

  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(e.message || ErrorMessage.UnknownError, e)
}
