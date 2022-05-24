import { StatusManager } from '.'
import {
  AcceptStepUpdateHook,
  CrossStep,
  LifiStep,
  Step,
  SwapStep,
} from '../types'
import { LifiErrorCode, TransactionError } from '../utils/errors'
import { getSlippageNotMetMessage } from '../utils/parseError'
import { updatedStepMeetsSlippageConditions } from './utils'

/**
 * This method checks whether the new and updated Step meets the required slippage conditions.
 * If yes it returns the updated Step.
 * If no and if user interaction is allowed it triggers the acceptStepUpdateHook. If no user interaction is allowed it aborts.
 *
 * @param statusManager
 * @param oldStep
 * @param newStep
 * @param acceptStepUpdateHook
 * @param allowUserInteraction
 */
export const stepComparison = async (
  statusManager: StatusManager,
  oldStep: Step,
  newStep: Step,
  acceptStepUpdateHook: AcceptStepUpdateHook,
  allowUserInteraction: boolean
): Promise<Step> => {
  if (updatedStepMeetsSlippageConditions(oldStep, newStep)) {
    return statusManager.updateStepInRoute(newStep)
  }
  let allowStepUpdate: boolean | undefined
  if (allowUserInteraction) {
    allowStepUpdate = await acceptStepUpdateHook()
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
