import { StatusManager } from '.'
import { AcceptSlippageUpdateHook, Step } from '../types'
import { LifiErrorCode, TransactionError } from '../utils/errors'
import { getSlippageNotMetMessage } from '../utils/parseError'
import { updatedStepMeetsSlippageConditions } from './utils'

/**
 * This method checks whether the new and updated Step meets the required slippage conditions.
 * If yes it returns the updated Step.
 * If no and if user interaction is allowed it triggers the acceptSlippageUpdateHook. If no user interaction is allowed it aborts.
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
  acceptSlippageUpdateHook: AcceptSlippageUpdateHook,
  allowUserInteraction: boolean
): Promise<Step> => {
  if (updatedStepMeetsSlippageConditions(oldStep, newStep)) {
    return statusManager.updateStepInRoute(newStep)
  }
  let allowStepUpdate: boolean | undefined
  if (allowUserInteraction) {
    allowStepUpdate = await acceptSlippageUpdateHook({
      oldToAmount: oldStep.estimate.toAmount,
      newToAmount: newStep.estimate.toAmount,
      toToken: newStep.action.toToken,
      oldSlippage: oldStep.action.slippage,
      newSlippage: newStep.action.slippage,
    })
  }

  if (!allowStepUpdate) {
    throw new TransactionError(
      LifiErrorCode.SlippageNotMet,
      'Slippage conditions not met!',
      getSlippageNotMetMessage(oldStep)
    )
  }

  return statusManager.updateStepInRoute(newStep)
}
