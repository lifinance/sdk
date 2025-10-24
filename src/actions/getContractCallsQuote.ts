import type {
  ContractCallsQuoteRequest,
  LiFiStep,
  RequestOptions,
} from '@lifi/types'
import {
  isContractCallsRequestWithFromAmount,
  isContractCallsRequestWithToAmount,
} from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'
import type { SDKClient } from '../types/core.js'

/**
 * Get a quote for a destination contract call
 * @param client - The SDK client
 * @param params - The configuration of the requested destination call
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns - Returns step.
 */
export const getContractCallsQuote = async (
  client: SDKClient,
  params: ContractCallsQuoteRequest,
  options?: RequestOptions
): Promise<LiFiStep> => {
  // validation
  const requiredParameters: Array<keyof ContractCallsQuoteRequest> = [
    'fromChain',
    'fromToken',
    'fromAddress',
    'toChain',
    'toToken',
    'contractCalls',
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
  if (
    !isContractCallsRequestWithFromAmount(params) &&
    !isContractCallsRequestWithToAmount(params)
  ) {
    throw new SDKError(
      new ValidationError(
        `Required parameter "fromAmount" or "toAmount" is missing.`
      )
    )
  }
  // apply defaults
  // option.order is not used in this endpoint
  params.integrator ??= client.config.integrator
  params.slippage ??= client.config.routeOptions?.slippage
  params.referrer ??= client.config.routeOptions?.referrer
  params.fee ??= client.config.routeOptions?.fee
  params.allowBridges ??= client.config.routeOptions?.bridges?.allow
  params.denyBridges ??= client.config.routeOptions?.bridges?.deny
  params.preferBridges ??= client.config.routeOptions?.bridges?.prefer
  params.allowExchanges ??= client.config.routeOptions?.exchanges?.allow
  params.denyExchanges ??= client.config.routeOptions?.exchanges?.deny
  params.preferExchanges ??= client.config.routeOptions?.exchanges?.prefer
  // send request
  return await request<LiFiStep>(
    client.config,
    `${client.config.apiUrl}/quote/contractCalls`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      signal: options?.signal,
    }
  )
}
