import type { LiFiStep, Process } from '@lifi/types'
import { getGenericUnknownError } from '../../utils/errors/create.js'
import { LiFiSDKError } from '../../utils/errors/SDKError.js'
import { ErrorMessage } from '../../utils/errors/constants.js'
import { LiFiBaseError } from '../../utils/index.js'

// TODO: consolidate this with the parseSolanaStepError - its now the same code
export const parseEVMStepErrors = async (
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
      getGenericUnknownError(
        e.message || ErrorMessage.UnknownError,
        undefined,
        e
      ),
    step,
    process
  )
}
