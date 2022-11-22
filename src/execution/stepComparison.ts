import { StatusManager } from '.'
import { InternalExecutionSettings, Step } from '../types'
import { LifiErrorCode, TransactionError } from '../utils/errors'
import { getExchangeRateChangedMessage } from '../utils/parseError'
import { checkStepSlippageThreshold } from './utils'

/**
 * This method checks whether the new and updated Step meets the required exchange rate conditions.
 * If yes it returns the updated Step.
 * If no and if user interaction is allowed it triggers the acceptExchangeRateUpdateHook. If no user interaction is allowed it aborts.
 *
 * @param statusManager
 * @param oldStep
 * @param newStep
 * @param acceptSlippageUpdateHook
 * @param allowUserInteraction
 */
export const stepComparison = async (
  statusManager: StatusManager,
  oldStep: Step,
  newStep: Step,
  settings: InternalExecutionSettings,
  allowUserInteraction: boolean
): Promise<Step> => {
  // Check if changed exchange rate is in the range of slippage threshold
  if (checkStepSlippageThreshold(oldStep, newStep)) {
    return statusManager.updateStepInRoute(newStep)
  }

  const acceptExchangeRateUpdateHook =
    settings.acceptExchangeRateUpdateHook ?? settings.acceptSlippageUpdateHook
  let allowStepUpdate: boolean | undefined
  if (allowUserInteraction) {
    allowStepUpdate = await acceptExchangeRateUpdateHook({
      oldToAmount: oldStep.estimate.toAmount,
      newToAmount: newStep.estimate.toAmount,
      toToken: newStep.action.toToken,
      oldSlippage: oldStep.action.slippage,
      newSlippage: newStep.action.slippage,
    } as any)
  }

  if (!allowStepUpdate) {
    // The user declined the new exchange rate, so we are not going to proceed
    throw new TransactionError(
      LifiErrorCode.TransactionCanceled,
      'Exchange rate has changed!',
      getExchangeRateChangedMessage(oldStep)
    )
  }

  return statusManager.updateStepInRoute(newStep)
}
