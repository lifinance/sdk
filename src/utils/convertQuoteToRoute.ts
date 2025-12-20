import type { LiFiStep, Route, Step } from '@lifi/types'
import { formatUnits } from 'viem'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'

interface ConvertQuoteToRouteOptions {
  /**
   * When true, if the quote has zero output values (toAmount, toAmountMin, toAmountUSD),
   * use the values from the previous included step that has non-zero output.
   */
  adjustZeroOutputFromPreviousStep?: boolean
}

const parseBigInt = (value: string | undefined): bigint => {
  if (!value) {
    return 0n
  }
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

const parseNumber = (value: string | undefined): number => {
  if (!value) {
    return 0
  }
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

const isZeroOutput = (
  toAmount: string,
  toAmountMin: string,
  toAmountUSD?: string
): boolean => {
  return (
    !parseBigInt(toAmount) &&
    !parseBigInt(toAmountMin) &&
    !parseNumber(toAmountUSD)
  )
}

const hasNonZeroOutput = (step: Step): boolean => {
  return (
    !!parseBigInt(step.estimate.toAmount) ||
    !!parseBigInt(step.estimate.toAmountMin)
  )
}

const findPreviousNonZeroStep = (steps: Step[]): Step | undefined => {
  // Find the last step that has non-zero output (the step before the zero output step)
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]
    if (hasNonZeroOutput(step)) {
      return step
    }
  }
  return undefined
}

export function formatTokenPrice(
  amount?: string | bigint,
  price?: string,
  decimals?: number
) {
  if (!amount || !price) {
    return 0
  }

  const formattedAmount =
    typeof amount === 'bigint' && decimals !== undefined
      ? formatUnits(amount, decimals)
      : amount.toString()

  if (Number.isNaN(Number(formattedAmount)) || Number.isNaN(Number(price))) {
    return 0
  }
  return Number.parseFloat(formattedAmount) * Number.parseFloat(price)
}

/**
 * Converts a quote to Route
 * @param quote - Step returned from the quote endpoint.
 * @param options - Optional configuration for handling edge cases.
 * @returns - The route to be executed.
 * @throws {BaseError} Throws a ValidationError if the step has missing values.
 */
export const convertQuoteToRoute = (
  quote: LiFiStep,
  options?: ConvertQuoteToRouteOptions
): Route => {
  let toAmount = quote.estimate.toAmount
  let toAmountMin = quote.estimate.toAmountMin
  let toAmountUSD = quote.estimate.toAmountUSD

  // Handle zero output values by looking at previous included step
  if (
    options?.adjustZeroOutputFromPreviousStep &&
    quote.includedSteps?.length &&
    isZeroOutput(toAmount, toAmountMin, toAmountUSD)
  ) {
    const previousStep = findPreviousNonZeroStep(quote.includedSteps)
    if (previousStep) {
      toAmount = previousStep.estimate.toAmount
      toAmountMin = previousStep.estimate.toAmountMin
      toAmountUSD = formatTokenPrice(
        parseBigInt(toAmount),
        previousStep.action.toToken.priceUSD,
        previousStep.action.toToken.decimals
      ).toFixed(2)

      // Update the last included step's estimate with the adjusted values
      const lastStep = quote.includedSteps[quote.includedSteps.length - 1]
      if (lastStep && !hasNonZeroOutput(lastStep)) {
        lastStep.estimate.toAmount = toAmount
        lastStep.estimate.toAmountMin = toAmountMin
      }
    }
  }

  if (!quote.estimate.fromAmountUSD) {
    throw new SDKError(
      new ValidationError("Missing 'fromAmountUSD' in step estimate.")
    )
  }

  if (!toAmountUSD) {
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
    toAmount,
    toAmountMin,
    toAmountUSD,
    toAddress: quote.action.toAddress || quote.action.fromAddress,
    gasCostUSD: quote.estimate.gasCosts?.[0]?.amountUSD || '0',
    steps: [quote],
    insurance: { state: 'NOT_INSURABLE', feeAmountUsd: '0' },
  }

  return route
}
