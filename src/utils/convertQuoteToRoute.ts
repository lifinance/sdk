import type { LiFiStep, Route } from '@lifi/types'
import { SDKError } from '../errors/SDKError.js'
import { ValidationError } from '../errors/errors.js'

/**
 * Converts a quote to Route
 * @param step - Step returned from the quote endpoint.
 * @param txHash
 * @param chainId
 * @returns - The route to be executed.
 * @throws {BaseError} Throws a ValidationError if the step has missing values.
 */
export const convertQuoteToRoute = (step: LiFiStep): Route => {
  if (!step.estimate.fromAmountUSD) {
    throw new SDKError(
      new ValidationError("Missing 'fromAmountUSD' in step estimate.")
    )
  }

  if (!step.estimate.toAmountUSD) {
    throw new SDKError(
      new ValidationError("Missing 'toAmountUSD' in step estimate.")
    )
  }

  const route: Route = {
    fromToken: step.action.fromToken,
    toToken: step.action.toToken,
    fromAmount: step.action.fromAmount,
    toAmount: step.estimate.toAmount,
    id: step.id,
    fromChainId: step.action.fromToken.chainId,
    toChainId: step.action.toToken.chainId,
    fromAmountUSD: step.estimate.fromAmountUSD,
    toAmountUSD: step.estimate.toAmountUSD,
    steps: [step],
    toAmountMin: step.estimate.toAmountMin,
    insurance: { state: 'NOT_INSURABLE', feeAmountUsd: '0' },
  }

  return route
}
