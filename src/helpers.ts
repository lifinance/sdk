import type { LiFiStep, Route } from '@lifi/types'
import { request } from './request'
import type { TenderlyResponse } from './types'
import { ValidationError } from './utils/errors'
import { name, version } from './version'

/**
 * Returns a random number between min (inclusive) and max (inclusive)
 * @param min - minimum number.
 * @param max - maximum number.
 * @returns - random number.
 */
export const getRandomNumber = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1) + min)
}

function semverCompare(a: string, b: string) {
  if (a.startsWith(b + '-')) {
    return -1
  }
  if (b.startsWith(a + '-')) {
    return 1
  }
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: 'case',
    caseFirst: 'upper',
  })
}

export const checkPackageUpdates = async (
  packageName?: string,
  packageVersion?: string,
  disableCheck?: boolean
) => {
  if (disableCheck || process.env.NODE_ENV !== 'development') {
    return
  }
  try {
    const pkgName = packageName ?? name
    const response = await request<{ version: string }>(
      `https://registry.npmjs.org/${pkgName}/latest`,
      { skipTrackingHeaders: true }
    )
    const latestVersion = response.version
    const currentVersion = packageVersion ?? version
    if (semverCompare(latestVersion, currentVersion)) {
      console.warn(
        // eslint-disable-next-line max-len
        `${pkgName}: new package version is available. Please update as soon as possible to enjoy the newest features. Current version: ${currentVersion}. Latest version: ${latestVersion}.`
      )
    }
  } catch (error) {
    // Cannot verify version, might be network error etc. We don't bother showing anything in that case
  }
}

/**
 * Converts a quote to Route
 * @param step - Step returned from the quote endpoint.
 * @returns - The route to be executed.
 * @throws {ValidationError} Throws a ValidationError if the step has missing values.
 */
export const convertQuoteToRoute = (step: LiFiStep): Route => {
  if (!step.estimate.fromAmountUSD) {
    throw new ValidationError("Missing 'fromAmountUSD' in step estimate.")
  }

  if (!step.estimate.toAmountUSD) {
    throw new ValidationError("Missing 'toAmountUSD' in step estimate.")
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

export const fetchTxErrorDetails = async (txHash: string, chainId: number) => {
  const response = await request<TenderlyResponse>(
    `https://api.tenderly.co/api/v1/public-contract/${chainId}/tx/${txHash}`
  )

  return response
}
