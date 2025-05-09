import type { LiFiStep } from '@lifi/types'
import { SDKError } from '../../errors/SDKError.js'
import { BaseError } from '../../errors/baseError.js'
import { ErrorMessage, LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError, UnknownError } from '../../errors/errors.js'
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
  // Handle wallet signature rejection
  if (
    e.name === 'WalletSignTransactionError' ||
    e.message?.includes('User rejected the transaction')
  ) {
    return new TransactionError(LiFiErrorCode.SignatureRejected, e.message, e)
  }

  // Handle transaction execution failures
  if (
    e.name === 'ExecutionError' ||
    e.message?.includes('Transaction execution failed')
  ) {
    return new TransactionError(LiFiErrorCode.TransactionFailed, e.message, e)
  }

  // Handle transaction expiration
  if (
    e.name === 'TransactionExpiredError' ||
    e.message?.includes('Transaction expired')
  ) {
    return new TransactionError(LiFiErrorCode.TransactionExpired, e.message, e)
  }

  // Handle insufficient gas errors
  if (
    e.message?.includes('insufficient gas') ||
    e.message?.includes('gas budget')
  ) {
    return new TransactionError(LiFiErrorCode.InsufficientFunds, e.message, e)
  }

  // Handle simulation failures
  if (e.message?.includes('simulate') || e.message?.includes('simulation')) {
    return new TransactionError(
      LiFiErrorCode.TransactionSimulationFailed,
      e.message,
      e
    )
  }

  // Handle object not found errors
  if (
    e.message?.includes('Object not found') ||
    e.message?.includes('object does not exist')
  ) {
    return new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Required object not found on chain',
      e
    )
  }

  // Handle package upgrade errors
  if (
    e.message?.includes('package upgrade') ||
    e.message?.includes('package version')
  ) {
    return new TransactionError(
      LiFiErrorCode.TransactionFailed,
      'Package upgrade error',
      e
    )
  }

  if (e instanceof BaseError) {
    return e
  }

  return new UnknownError(e.message || ErrorMessage.UnknownError, e)
}
