import {
  type ChainId,
  type ChainKey,
  type ChainsRequest,
  type ChainsResponse,
  type ConnectionsRequest,
  type ConnectionsResponse,
  type ContractCallsQuoteRequest,
  type ExtendedChain,
  type GasRecommendationRequest,
  type GasRecommendationResponse,
  type GetStatusRequest,
  type LiFiStep,
  type QuoteRequest,
  type RequestOptions,
  type RoutesRequest,
  type RoutesResponse,
  type StatusResponse,
  type Token,
  type TokensRequest,
  type TokensResponse,
  type ToolsRequest,
  type ToolsResponse,
  type TransactionAnalyticsRequest,
  type TransactionAnalyticsResponse,
  isContractCallsRequestWithFromAmount,
  isContractCallsRequestWithToAmount,
} from '@lifi/types'
import { config } from '../config.js'
import { SDKError } from '../errors/SDKError.js'
import { ValidationError } from '../errors/errors.js'
import { request } from '../request.js'
import { isRoutesRequest, isStep } from '../typeguards.js'
import { withDedupe } from '../utils/withDedupe.js'
/**
 * Fetch information about a Token
 * @param chain - Id or key of the chain that contains the token
 * @param token - Address or symbol of the token on the requested chain
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Token information
 */
export const getToken = async (
  chain: ChainKey | ChainId,
  token: string,
  options?: RequestOptions
): Promise<Token> => {
  if (!chain) {
    throw new SDKError(
      new ValidationError('Required parameter "chain" is missing.')
    )
  }
  if (!token) {
    throw new SDKError(
      new ValidationError('Required parameter "token" is missing.')
    )
  }
  return await request<Token>(
    `${config.get().apiUrl}/token?${new URLSearchParams({
      chain,
      token,
    } as Record<string, string>)}`,
    {
      signal: options?.signal,
    }
  )
}

/**
 * Get a quote for a token transfer
 * @param params - The configuration of the requested quote
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Quote for a token transfer
 */
export const getQuote = async (
  params: QuoteRequest,
  options?: RequestOptions
): Promise<LiFiStep> => {
  const requiredParameters: Array<keyof QuoteRequest> = [
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
  const _config = config.get()
  // apply defaults
  params.integrator ??= _config.integrator
  params.order ??= _config.routeOptions?.order
  params.slippage ??= _config.routeOptions?.slippage
  params.referrer ??= _config.routeOptions?.referrer
  params.fee ??= _config.routeOptions?.fee
  params.allowBridges ??= _config.routeOptions?.bridges?.allow
  params.denyBridges ??= _config.routeOptions?.bridges?.deny
  params.preferBridges ??= _config.routeOptions?.bridges?.prefer
  params.allowExchanges ??= _config.routeOptions?.exchanges?.allow
  params.denyExchanges ??= _config.routeOptions?.exchanges?.deny
  params.preferExchanges ??= _config.routeOptions?.exchanges?.prefer

  for (const key of Object.keys(params)) {
    if (!params[key as keyof QuoteRequest]) {
      delete params[key as keyof QuoteRequest]
    }
  }

  return await request<LiFiStep>(
    `${_config.apiUrl}/quote?${new URLSearchParams(
      params as unknown as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )
}

/**
 * Get a quote for a destination contract call
 * @param params - The configuration of the requested destination call
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns - Returns step.
 */
export const getContractCallsQuote = async (
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
  const _config = config.get()
  // apply defaults
  // option.order is not used in this endpoint
  params.integrator ??= _config.integrator
  params.slippage ??= _config.routeOptions?.slippage
  params.referrer ??= _config.routeOptions?.referrer
  params.fee ??= _config.routeOptions?.fee
  params.allowBridges ??= _config.routeOptions?.bridges?.allow
  params.denyBridges ??= _config.routeOptions?.bridges?.deny
  params.preferBridges ??= _config.routeOptions?.bridges?.prefer
  params.allowExchanges ??= _config.routeOptions?.exchanges?.allow
  params.denyExchanges ??= _config.routeOptions?.exchanges?.deny
  params.preferExchanges ??= _config.routeOptions?.exchanges?.prefer
  // send request
  return await request<LiFiStep>(`${_config.apiUrl}/quote/contractCalls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    signal: options?.signal,
  })
}

/**
 * Check the status of a transfer. For cross chain transfers, the "bridge" parameter is required.
 * @param params - Configuration of the requested status
 * @param options - Request options.
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Returns status response.
 */
export const getStatus = async (
  params: GetStatusRequest,
  options?: RequestOptions
): Promise<StatusResponse> => {
  if (!params.txHash) {
    throw new SDKError(
      new ValidationError('Required parameter "txHash" is missing.')
    )
  }
  const queryParams = new URLSearchParams(
    params as unknown as Record<string, string>
  )
  return await request<StatusResponse>(
    `${config.get().apiUrl}/status?${queryParams}`,
    {
      signal: options?.signal,
    }
  )
}

/**
 * Get all available chains
 * @param params - The configuration of the requested chains
 * @param options - Request options
 * @returns A list of all available chains
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getChains = async (
  params?: ChainsRequest,
  options?: RequestOptions
): Promise<ExtendedChain[]> => {
  if (params) {
    for (const key of Object.keys(params)) {
      if (!params[key as keyof ChainsRequest]) {
        delete params[key as keyof ChainsRequest]
      }
    }
  }
  const urlSearchParams = new URLSearchParams(
    params as Record<string, string>
  ).toString()
  const response = await withDedupe(
    () =>
      request<ChainsResponse>(
        `${config.get().apiUrl}/chains?${urlSearchParams}`,
        {
          signal: options?.signal,
        }
      ),
    { id: `${getChains.name}.${urlSearchParams}` }
  )
  return response.chains
}

/**
 * Get a set of routes for a request that describes a transfer of tokens.
 * @param params - A description of the transfer.
 * @param options - Request options
 * @returns The resulting routes that can be used to realize the described transfer of tokens.
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getRoutes = async (
  params: RoutesRequest,
  options?: RequestOptions
): Promise<RoutesResponse> => {
  if (!isRoutesRequest(params)) {
    throw new SDKError(new ValidationError('Invalid routes request.'))
  }
  const _config = config.get()
  // apply defaults
  params.options = {
    integrator: _config.integrator,
    ..._config.routeOptions,
    ...params.options,
  }

  return await request<RoutesResponse>(`${_config.apiUrl}/advanced/routes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    signal: options?.signal,
  })
}

/**
 * Get the transaction data for a single step of a route
 * @param step - The step object.
 * @param options - Request options
 * @returns The step populated with the transaction data.
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getStepTransaction = async (
  step: LiFiStep,
  options?: RequestOptions
): Promise<LiFiStep> => {
  if (!isStep(step)) {
    // While the validation fails for some users we should not enforce it
    console.warn('SDK Validation: Invalid Step', step)
  }

  return await request<LiFiStep>(
    `${config.get().apiUrl}/advanced/stepTransaction`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(step),
      signal: options?.signal,
    }
  )
}

/**
 * Get the available tools to bridge and swap tokens.
 * @param params - The configuration of the requested tools
 * @param options - Request options
 * @returns The tools that are available on the requested chains
 */
export const getTools = async (
  params?: ToolsRequest,
  options?: RequestOptions
): Promise<ToolsResponse> => {
  if (params) {
    for (const key of Object.keys(params)) {
      if (!params[key as keyof ToolsRequest]) {
        delete params[key as keyof ToolsRequest]
      }
    }
  }
  return await request<ToolsResponse>(
    `${config.get().apiUrl}/tools?${new URLSearchParams(
      params as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )
}

/**
 * Get all known tokens.
 * @param params - The configuration of the requested tokens
 * @param options - Request options
 * @returns The tokens that are available on the requested chains
 */
export const getTokens = async (
  params?: TokensRequest,
  options?: RequestOptions
): Promise<TokensResponse> => {
  if (params) {
    for (const key of Object.keys(params)) {
      if (!params[key as keyof TokensRequest]) {
        delete params[key as keyof TokensRequest]
      }
    }
  }
  const urlSearchParams = new URLSearchParams(
    params as Record<string, string>
  ).toString()
  const response = await withDedupe(
    () =>
      request<TokensResponse>(
        `${config.get().apiUrl}/tokens?${urlSearchParams}`,
        {
          signal: options?.signal,
        }
      ),
    { id: `${getTokens.name}.${urlSearchParams}` }
  )
  return response
}

/**
 * Get gas recommendation for a certain chain
 * @param params - Configuration of the requested gas recommendation.
 * @param options - Request options
 * @throws {LiFiError} Throws a LiFiError if request fails.
 * @returns Gas recommendation response.
 */
export const getGasRecommendation = async (
  params: GasRecommendationRequest,
  options?: RequestOptions
): Promise<GasRecommendationResponse> => {
  if (!params.chainId) {
    throw new SDKError(
      new ValidationError('Required parameter "chainId" is missing.')
    )
  }

  const url = new URL(`${config.get().apiUrl}/gas/suggestion/${params.chainId}`)
  if (params.fromChain) {
    url.searchParams.append('fromChain', params.fromChain as unknown as string)
  }
  if (params.fromToken) {
    url.searchParams.append('fromToken', params.fromToken)
  }

  return await request<GasRecommendationResponse>(url.toString(), {
    signal: options?.signal,
  })
}

/**
 * Get all the available connections for swap/bridging tokens
 * @param connectionRequest ConnectionsRequest
 * @param options - Request options
 * @returns ConnectionsResponse
 */
export const getConnections = async (
  connectionRequest: ConnectionsRequest,
  options?: RequestOptions
): Promise<ConnectionsResponse> => {
  const url = new URL(`${config.get().apiUrl}/connections`)

  const { fromChain, fromToken, toChain, toToken } = connectionRequest

  if (fromChain) {
    url.searchParams.append('fromChain', fromChain as unknown as string)
  }
  if (fromToken) {
    url.searchParams.append('fromToken', fromToken)
  }
  if (toChain) {
    url.searchParams.append('toChain', toChain as unknown as string)
  }
  if (toToken) {
    url.searchParams.append('toToken', toToken)
  }
  const connectionRequestArrayParams: Array<keyof ConnectionsRequest> = [
    'allowBridges',
    'denyBridges',
    'preferBridges',
    'allowExchanges',
    'denyExchanges',
    'preferExchanges',
  ]
  for (const parameter of connectionRequestArrayParams) {
    const connectionRequestArrayParam = connectionRequest[parameter] as string[]

    if (connectionRequestArrayParam?.length) {
      for (const value of connectionRequestArrayParam) {
        url.searchParams.append(parameter, value)
      }
    }
  }
  return await request<ConnectionsResponse>(url, options)
}

export const getTransactionHistory = async (
  { wallet, status, fromTimestamp, toTimestamp }: TransactionAnalyticsRequest,
  options?: RequestOptions
): Promise<TransactionAnalyticsResponse> => {
  if (!wallet) {
    throw new SDKError(
      new ValidationError('Required parameter "wallet" is missing.')
    )
  }

  const _config = config.get()

  const url = new URL(`${_config.apiUrl}/analytics/transfers`)

  url.searchParams.append('integrator', _config.integrator)
  url.searchParams.append('wallet', wallet)

  if (status) {
    url.searchParams.append('status', status)
  }

  if (fromTimestamp) {
    url.searchParams.append('fromTimestamp', fromTimestamp.toString())
  }

  if (toTimestamp) {
    url.searchParams.append('toTimestamp', toTimestamp.toString())
  }

  return await request<TransactionAnalyticsResponse>(url, options)
}
