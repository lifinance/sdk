import type { LiFiStep } from '@lifi/types'
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError } from '../errors/errors.js'
import type { StatusManager } from './StatusManager.js'
import type { ExecutionOptions } from './types.js'
import { checkStepSlippageThreshold } from './utils.js'

/**
 * This method checks whether the new and updated Step meets the required exchange rate conditions.
 * If yes it returns the updated Step.
 * If no and if user interaction is allowed it triggers the acceptExchangeRateUpdateHook. If no user interaction is allowed it aborts.
 * @param statusManager
 * @param oldStep
 * @param newStep
 * @param settings
 * @param allowUserInteraction
 * @param executionOptions
 * @returns Return LiFiStep
 */
export const stepComparison = async (
  statusManager: StatusManager,
  oldStep: LiFiStep,
  newStep: LiFiStep,
  allowUserInteraction: boolean,
  executionOptions?: ExecutionOptions
): Promise<LiFiStep> => {
  // Check if changed exchange rate is in the range of slippage threshold
  if (checkStepSlippageThreshold(oldStep, newStep)) {
    return statusManager.updateStepInRoute(newStep)
  }

  let allowStepUpdate: boolean | undefined
  if (allowUserInteraction) {
    allowStepUpdate = await executionOptions?.acceptExchangeRateUpdateHook?.({
      oldToAmount: oldStep.estimate.toAmount,
      newToAmount: newStep.estimate.toAmount,
      toToken: newStep.action.toToken,
    })
  }

  if (!allowStepUpdate) {
    // The user declined the new exchange rate, so we are not going to proceed
    throw new TransactionError(
      LiFiErrorCode.ExchangeRateUpdateCanceled,
      'Exchange rate has changed!\nTransaction was not sent, your funds are still in your wallet.\nThe exchange rate has changed and the previous estimation can not be fulfilled due to value loss.'
    )
  }

  return statusManager.updateStepInRoute(newStep)
}
