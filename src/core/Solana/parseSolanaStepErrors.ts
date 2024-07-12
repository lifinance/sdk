import type { LiFiStep, Process } from '@lifi/types'
import { BaseError } from '../../utils/errors/baseError.js'
import { ErrorMessage } from '../../utils/errors/constants.js'
import { UnknownError } from '../../utils/errors/errors.js'
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

  let baseError

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
