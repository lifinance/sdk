import type {
  LiFiStep,
  RelayerQuoteResponse,
  RequestOptions,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'
import type { QuoteRequest, QuoteRequestFromAmount } from '../types/actions.js'

/**
 * Get a relayer quote for a token transfer
 * @param config - The SDK client configuration
 * @param params - The configuration of the requested quote
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Relayer quote for a token transfer
 */
export const getRelayerQuote = async (
  config: SDKBaseConfig,
  params: QuoteRequestFromAmount,
  options?: RequestOptions
): Promise<LiFiStep> => {
  const requiredParameters: Array<keyof QuoteRequestFromAmount> = [
    'fromChain',
    'fromToken',
    'fromAddress',
    'fromAmount',
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

  const result = await request<RelayerQuoteResponse>(
    config,
    `${config.apiUrl}/relayer/quote?${new URLSearchParams(
      params as unknown as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )

  if (result.status === 'error') {
    throw new BaseError(
      ErrorName.ServerError,
      result.data.code,
      result.data.message
    )
  }

  return result.data
}
