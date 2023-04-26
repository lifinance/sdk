import { StatusManager } from '.'
import { InternalExecutionSettings, LifiStep } from '../types'
import { LifiErrorCode, TransactionError } from '../utils/errors'
import { checkStepSlippageThreshold } from './utils'

/**
 * This method checks whether the new and updated Step meets the required exchange rate conditions.
 * If yes it returns the updated Step.
 * If no and if user interaction is allowed it triggers the acceptExchangeRateUpdateHook. If no user interaction is allowed it aborts.
 *
 * @param statusManager
 * @param oldStep
 * @param newStep
 * @param settings
 * @param allowUserInteraction
 */
export const stepComparison = async (
  statusManager: StatusManager,
  oldStep: LifiStep,
  newStep: LifiStep,
  settings: InternalExecutionSettings,
  allowUserInteraction: boolean
): Promise<LifiStep> => {
  // Check if changed exchange rate is in the range of slippage threshold
  if (checkStepSlippageThreshold(oldStep, newStep)) {
    return statusManager.updateStepInRoute(newStep)
  }

  let allowStepUpdate: boolean | undefined
  if (allowUserInteraction) {
    allowStepUpdate = await settings.acceptExchangeRateUpdateHook({
      oldToAmount: oldStep.estimate.toAmount,
      newToAmount: newStep.estimate.toAmount,
      toToken: newStep.action.toToken,
    })
  }

  if (!allowStepUpdate) {
    // The user declined the new exchange rate, so we are not going to proceed
    throw new TransactionError(
      LifiErrorCode.TransactionCanceled,
      'Exchange rate has changed!',
      `Transaction was not sent, your funds are still in your wallet.
      The exchange rate has changed and the previous estimation can not be fulfilled due to value loss.`
    )
  }

  return statusManager.updateStepInRoute(newStep)
}
