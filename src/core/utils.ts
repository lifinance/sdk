import type { LiFiStep, Token } from '@lifi/types'

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

/**
 * Checks whether a given token is eligible for message signing.
 * Tokens with '₮' symbol in their name are disallowed,
 * since such tokens may have non-standard signing requirements or compatibility issues with hardware wallets.
 *
 * @param token - The token object to check.
 * @returns true if the token is allowed for message signing, false otherwise.
 */
export const isTokenMessageSigningAllowed = (token: Token): boolean => {
  return !token.name?.includes('₮') && !token.symbol?.includes('₮')
}
