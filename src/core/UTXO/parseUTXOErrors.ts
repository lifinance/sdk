import type { LiFiStep, Process } from '@lifi/types'
import { BaseError } from '../../errors/baseError.js'
import { ErrorMessage } from '../../errors/constants.js'
import { UnknownError } from '../../errors/errors.js'
import { SDKError } from '../../errors/SDKError.js'

export const parseUTXOErrors = async (
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
  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(e.message || ErrorMessage.UnknownError, e)
}
