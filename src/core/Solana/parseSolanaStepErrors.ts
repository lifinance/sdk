import type { LiFiStep, Process } from '@lifi/types'
import { LiFiBaseError } from '../../utils/errors/baseError.js'
import { ErrorMessage } from '../../utils/errors/constants.js'
import { UnknownError } from '../../utils/errors/create.js'
import { LiFiSDKError } from '../../utils/errors/SDKError.js'

export const parseSolanaStepErrors = async (
  e: Error,
  step?: LiFiStep,
  process?: Process
): Promise<LiFiSDKError> => {
  if (e instanceof LiFiSDKError) {
    e.step = e.step ?? step
    e.process = e.process ?? process
    return e
  }

  let baseError

  if (e instanceof LiFiBaseError) {
    baseError = e
  }

  return new LiFiSDKError(
    baseError ??
      new UnknownError(e.message || ErrorMessage.UnknownError, undefined, e),
    step,
    process
  )
}
