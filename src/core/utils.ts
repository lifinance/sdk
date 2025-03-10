import type { LiFiStep } from '@lifi/types'

// Standard threshold for destination amount difference (0.5%)
const standardThreshold = 0.005

/**
 * Used to check if changed exchange rate is in the range of slippage threshold.
 * We use a slippage value as a threshold to trigger the rate change hook.
 * This can result in almost doubled slippage for the user and need to be revisited.
 * @param oldStep - old step
 * @param newStep - new step
 * @returns Boolean
 */
export function checkStepSlippageThreshold(
  oldStep: LiFiStep,
  newStep: LiFiStep
): boolean {
  const setSlippage = oldStep.action.slippage || standardThreshold
  const oldEstimatedToAmount = BigInt(oldStep.estimate.toAmountMin)
  const newEstimatedToAmount = BigInt(newStep.estimate.toAmountMin)
  const amountDifference = oldEstimatedToAmount - newEstimatedToAmount
  // oldEstimatedToAmount can be 0 when we use contract calls
  let actualSlippage = 0
  if (oldEstimatedToAmount > 0) {
    actualSlippage =
      Number((amountDifference * 1_000_000_000n) / oldEstimatedToAmount) /
      1_000_000_000
  }
  return actualSlippage <= setSlippage
}
