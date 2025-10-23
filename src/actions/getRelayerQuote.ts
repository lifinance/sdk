import type {
  LiFiStep,
  RelayerQuoteResponse,
  RequestOptions,
} from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'
import type { QuoteRequest, QuoteRequestFromAmount } from '../types/actions.js'

/**
 * Get a relayer quote for a token transfer
 * @param client - The SDK client
 * @param params - The configuration of the requested quote
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Relayer quote for a token transfer
 */
export const getRelayerQuote = async (
  client: SDKClient,
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

  const result = await request<RelayerQuoteResponse>(
    client.config,
    `${client.config.apiUrl}/relayer/quote?${new URLSearchParams(
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
