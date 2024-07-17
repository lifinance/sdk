import type { LiFiStep, Process } from '@lifi/types'
import { BaseError } from '../../utils/errors/baseError.js'
import { ErrorMessage, LiFiErrorCode } from '../../utils/errors/constants.js'
import { TransactionError, UnknownError } from '../../utils/errors/errors.js'
import { SDKError } from '../../utils/errors/SDKError.js'

export const parseSolanaStepErrors = async (
  e: Error,
  step?: LiFiStep,
  process?: Process
): Promise<SDKError> => {
  if (e instanceof SDKError) {
    e.step = e.step ?? step
    e.process = e.process ?? process
    return e
  }

  console.log('parseSolanaStepErrors', e.name, e.message, e)

  let baseError

  baseError = handleSolanaErrors(e)

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

const handleSolanaErrors = (e: any) => {
  if (e.name === 'WalletSignTransactionError') {
    return new TransactionError(
      LiFiErrorCode.SignatureRejected,
      e.message,
      undefined,
      e
    )
  }
  return
}
