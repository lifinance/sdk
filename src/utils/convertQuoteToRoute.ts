import type { LiFiStep, Route } from '@lifi/types'
import { SDKError } from '../errors/SDKError.js'
import { ValidationError } from '../errors/errors.js'

/**
 * Converts a quote to Route
 * @param quote - Step returned from the quote endpoint.
 * @param txHash
 * @param chainId
 * @returns - The route to be executed.
 * @throws {BaseError} Throws a ValidationError if the step has missing values.
 */
export const convertQuoteToRoute = (quote: LiFiStep): Route => {
  if (!quote.estimate.fromAmountUSD) {
    throw new SDKError(
      new ValidationError("Missing 'fromAmountUSD' in step estimate.")
    )
  }

  if (!quote.estimate.toAmountUSD) {
    throw new SDKError(
      new ValidationError("Missing 'toAmountUSD' in step estimate.")
    )
  }

  const route: Route = {
    id: quote.id,
    fromChainId: quote.action.fromToken.chainId,
    fromToken: quote.action.fromToken,
    fromAmount: quote.action.fromAmount,
    fromAmountUSD: quote.estimate.fromAmountUSD,
    fromAddress: quote.action.fromAddress,
    toChainId: quote.action.toToken.chainId,
    toToken: quote.action.toToken,
    toAmount: quote.estimate.toAmount,
    toAmountMin: quote.estimate.toAmountMin,
    toAmountUSD: quote.estimate.toAmountUSD,
    toAddress: quote.action.toAddress || quote.action.fromAddress,
    gasCostUSD: quote.estimate.gasCosts?.[0].amountUSD,
    steps: [quote],
    insurance: { state: 'NOT_INSURABLE', feeAmountUsd: '0' },
  }

  return route
}
