import type {
  ContractCallsQuoteRequest,
  LiFiStep,
  RequestOptions,
} from '@lifi/types'
import {
  isContractCallsRequestWithFromAmount,
  isContractCallsRequestWithToAmount,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'

/**
 * Get a quote for a destination contract call
 * @param config - The SDK client configuration
 * @param params - The configuration of the requested destination call
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns - Returns step.
 */
export const getContractCallsQuote = async (
  config: SDKBaseConfig,
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
  params.integrator ??= config.integrator
  params.slippage ??= config.routeOptions?.slippage
  params.referrer ??= config.routeOptions?.referrer
  params.fee ??= config.routeOptions?.fee
  params.allowBridges ??= config.routeOptions?.bridges?.allow
  params.denyBridges ??= config.routeOptions?.bridges?.deny
  params.preferBridges ??= config.routeOptions?.bridges?.prefer
  params.allowExchanges ??= config.routeOptions?.exchanges?.allow
  params.denyExchanges ??= config.routeOptions?.exchanges?.deny
  params.preferExchanges ??= config.routeOptions?.exchanges?.prefer
  // send request
  return await request<LiFiStep>(
    config,
    `${config.apiUrl}/quote/contractCalls`,
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
