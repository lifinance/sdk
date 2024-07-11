import type { LiFiStep, Process } from '@lifi/types'
import { errorCodes as MetaMaskErrorCodes } from 'eth-rpc-errors'
import {
  getGenericUnknownError,
  getRPCError,
  getTransactionError,
} from '../../utils/errors/create.js'
import { LiFiSDKError } from '../../utils/errors/SDKError.js'
import { LiFiErrorCode, ErrorMessage } from '../../utils/errors/constants.js'
import { getTransactionNotSentMessage } from '../../utils/getTransactionMessage.js'

enum EthersErrorMessage {
  LowGas = 'intrinsic gas too low',
  OutOfGas = 'out of gas',
  Underpriced = 'underpriced',
  LowReplacementFee = 'replacement fee too low',
}

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

  const baseError = await parseLegacyMetaMaskErrors(e, step, process)

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

// NOTE: No additions should be made to this function
//  When want to try to phase this code out
const parseLegacyMetaMaskErrors = async (
  e: any,
  step?: LiFiStep,
  process?: Process
) => {
  const errorCode = e.code || e.cause?.code

  if (errorCode && typeof errorCode === 'number') {
    if (Object.values(MetaMaskErrorCodes.rpc).includes(errorCode as any)) {
      // rpc errors
      // underpriced errors are sent as internal errors, so we need to parse the message manually
      // TODO: question: Still not sure what to replace this with
      if (
        errorCode === MetaMaskErrorCodes.rpc.internal &&
        (e.message?.includes(EthersErrorMessage.Underpriced) ||
          e.message?.includes(EthersErrorMessage.LowReplacementFee))
      ) {
        return getRPCError(
          LiFiErrorCode.TransactionUnderpriced,
          ErrorMessage.TransactionUnderpriced,
          await getTransactionNotSentMessage(step, process),
          e
        )
      }

      // TODO: replace with low gas errors - use viems IntrinsicGasTooLowError
      if (
        e.message?.includes(EthersErrorMessage.LowGas) ||
        e.message?.includes(EthersErrorMessage.OutOfGas)
      ) {
        return getTransactionError(
          LiFiErrorCode.GasLimitError,
          ErrorMessage.GasLimitLow,
          await getTransactionNotSentMessage(step, process),
          e
        )
      }
    }
  }
  return e
}
