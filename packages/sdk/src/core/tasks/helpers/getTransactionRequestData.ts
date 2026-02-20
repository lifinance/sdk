import { LiFiErrorCode } from '../../../errors/constants.js'
import { TransactionError } from '../../../errors/errors.js'
import type {
  ExecutionOptions,
  LiFiStepExtended,
  TransactionParameters,
} from '../../../types/core.js'

export const getTransactionRequestData = async (
  step: LiFiStepExtended,
  executionOptions?: ExecutionOptions
): Promise<string> => {
  if (!step.transactionRequest?.data) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'Unable to prepare transaction.'
    )
  }

  let transactionRequest: TransactionParameters = {
    data: step.transactionRequest.data,
  }

  if (executionOptions?.updateTransactionRequestHook) {
    const customizedTransactionRequest: TransactionParameters =
      await executionOptions.updateTransactionRequestHook({
        requestType: 'transaction',
        ...transactionRequest,
      })

    transactionRequest = {
      ...transactionRequest,
      ...customizedTransactionRequest,
    }
  }

  const transactionRequestData = transactionRequest.data

  if (!transactionRequestData) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'Unable to prepare transaction.'
    )
  }

  return transactionRequestData
}
