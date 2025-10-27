import type { LiFiStep, RequestOptions } from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type {
  QuoteRequest,
  QuoteRequestFromAmount,
  QuoteRequestToAmount,
} from '../types/actions.js'
import type { SDKClient } from '../types/core.js'
import { request } from '../utils/request.js'

/**
 * Get a quote for a token transfer
 * @param client - The SDK client
 * @param params - The configuration of the requested quote
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Quote for a token transfer
 */
export async function getQuote(
  client: SDKClient,
  params: QuoteRequestFromAmount,
  options?: RequestOptions
): Promise<LiFiStep>
export async function getQuote(
  client: SDKClient,
  params: QuoteRequestToAmount,
  options?: RequestOptions
): Promise<LiFiStep>
export async function getQuote(
  client: SDKClient,
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
  params.integrator ??= client.config.integrator
  params.order ??= client.config.routeOptions?.order
  params.slippage ??= client.config.routeOptions?.slippage
  params.referrer ??= client.config.routeOptions?.referrer
  params.fee ??= client.config.routeOptions?.fee
  params.allowBridges ??= client.config.routeOptions?.bridges?.allow
  params.denyBridges ??= client.config.routeOptions?.bridges?.deny
  params.preferBridges ??= client.config.routeOptions?.bridges?.prefer
  params.allowExchanges ??= client.config.routeOptions?.exchanges?.allow
  params.denyExchanges ??= client.config.routeOptions?.exchanges?.deny
  params.preferExchanges ??= client.config.routeOptions?.exchanges?.prefer

  for (const key of Object.keys(params)) {
    if (!params[key as keyof QuoteRequest]) {
      delete params[key as keyof QuoteRequest]
    }
  }

  return await request<LiFiStep>(
    client.config,
    `${client.config.apiUrl}/${isFromAmountRequest ? 'quote' : 'quote/toAmount'}?${new URLSearchParams(
      params as unknown as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )
}
