import type { LiFiStep, RequestOptions } from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'
import type {
  QuoteRequest,
  QuoteRequestFromAmount,
  QuoteRequestToAmount,
} from '../types/actions.js'

/**
 * Get a quote for a token transfer
 * @param config - The SDK client configuration
 * @param params - The configuration of the requested quote
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Quote for a token transfer
 */
export async function getQuote(
  config: SDKBaseConfig,
  params: QuoteRequestFromAmount,
  options?: RequestOptions
): Promise<LiFiStep>
export async function getQuote(
  config: SDKBaseConfig,
  params: QuoteRequestToAmount,
  options?: RequestOptions
): Promise<LiFiStep>
export async function getQuote(
  config: SDKBaseConfig,
  params: QuoteRequest,
  options?: RequestOptions
): Promise<LiFiStep> {
  const requiredParameters: Array<keyof QuoteRequest> = [
    'fromChain',
    'fromToken',
    'fromAddress',
    'toChain',
    'toToken',
  ]

  for (const requiredParameter of requiredParameters) {
    if (!params[requiredParameter]) {
      throw new SDKError(
        new ValidationError(
          `Required parameter "${requiredParameter}" is missing.`
        )
      )
    }
  }

  const isFromAmountRequest =
    'fromAmount' in params && params.fromAmount !== undefined
  const isToAmountRequest =
    'toAmount' in params && params.toAmount !== undefined

  if (!isFromAmountRequest && !isToAmountRequest) {
    throw new SDKError(
      new ValidationError(
        'Required parameter "fromAmount" or "toAmount" is missing.'
      )
    )
  }

  if (isFromAmountRequest && isToAmountRequest) {
    throw new SDKError(
      new ValidationError(
        'Cannot provide both "fromAmount" and "toAmount" parameters.'
      )
    )
  }

  // apply defaults
  params.integrator ??= config.integrator
  params.order ??= config.routeOptions?.order
  params.slippage ??= config.routeOptions?.slippage
  params.referrer ??= config.routeOptions?.referrer
  params.fee ??= config.routeOptions?.fee
  params.allowBridges ??= config.routeOptions?.bridges?.allow
  params.denyBridges ??= config.routeOptions?.bridges?.deny
  params.preferBridges ??= config.routeOptions?.bridges?.prefer
  params.allowExchanges ??= config.routeOptions?.exchanges?.allow
  params.denyExchanges ??= config.routeOptions?.exchanges?.deny
  params.preferExchanges ??= config.routeOptions?.exchanges?.prefer

  for (const key of Object.keys(params)) {
    if (!params[key as keyof QuoteRequest]) {
      delete params[key as keyof QuoteRequest]
    }
  }

  return await request<LiFiStep>(
    config,
    `${config.apiUrl}/${isFromAmountRequest ? 'quote' : 'quote/toAmount'}?${new URLSearchParams(
      params as unknown as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )
}
