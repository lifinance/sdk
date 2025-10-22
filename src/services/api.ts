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
  isContractCallsRequestWithFromAmount,
  isContractCallsRequestWithToAmount,
  type LiFiStep,
  type RelayerQuoteResponse,
  type RelayRequest,
  type RelayResponse,
  type RelayResponseData,
  type RelayStatusRequest,
  type RelayStatusResponse,
  type RelayStatusResponseData,
  type RequestOptions,
  type RoutesRequest,
  type RoutesResponse,
  type SignedLiFiStep,
  type StatusResponse,
  type TokenExtended,
  type TokensExtendedResponse,
  type TokensRequest,
  type TokensResponse,
  type ToolsRequest,
  type ToolsResponse,
  type TransactionAnalyticsRequest,
  type TransactionAnalyticsResponse,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'
import { isRoutesRequest, isStep } from '../typeguards.js'
import { withDedupe } from '../utils/withDedupe.js'
import type {
  GetStatusRequestExtended,
  QuoteRequest,
  QuoteRequestFromAmount,
  QuoteRequestToAmount,
} from './types.js'

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

/**
 * Get a set of routes for a request that describes a transfer of tokens.
 * @param config - The SDK client configuration
 * @param params - A description of the transfer.
 * @param options - Request options
 * @returns The resulting routes that can be used to realize the described transfer of tokens.
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getRoutes = async (
  config: SDKBaseConfig,
  params: RoutesRequest,
  options?: RequestOptions
): Promise<RoutesResponse> => {
  if (!isRoutesRequest(params)) {
    throw new SDKError(new ValidationError('Invalid routes request.'))
  }

  // apply defaults
  params.options = {
    integrator: config.integrator,
    ...config.routeOptions,
    ...params.options,
  }

  return await request<RoutesResponse>(
    config,
    `${config.apiUrl}/advanced/routes`,
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

/**
 * Get the transaction data for a single step of a route
 * @param config - The SDK client configuration
 * @param step - The step object.
 * @param options - Request options
 * @returns The step populated with the transaction data.
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getStepTransaction = async (
  config: SDKBaseConfig,
  step: LiFiStep | SignedLiFiStep,
  options?: RequestOptions
): Promise<LiFiStep> => {
  if (!isStep(step)) {
    // While the validation fails for some users we should not enforce it
    console.warn('SDK Validation: Invalid Step', step)
  }

  return await request<LiFiStep>(
    config,
    `${config.apiUrl}/advanced/stepTransaction`,
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
 * Check the status of a transfer. For cross chain transfers, the "bridge" parameter is required.
 * @param config - The SDK client configuration
 * @param params - Configuration of the requested status
 * @param options - Request options.
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Returns status response.
 */
export const getStatus = async (
  config: SDKBaseConfig,
  params: GetStatusRequestExtended,
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
    config,
    `${config.apiUrl}/status?${queryParams}`,
    {
      signal: options?.signal,
    }
  )
}

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

/**
 * Relay a transaction through the relayer service
 * @param config - The SDK client configuration
 * @param params - The configuration for the relay request
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Task ID for the relayed transaction
 */
export const relayTransaction = async (
  config: SDKBaseConfig,
  params: RelayRequest,
  options?: RequestOptions
): Promise<RelayResponseData> => {
  const requiredParameters: Array<keyof RelayRequest> = ['typedData']

  for (const requiredParameter of requiredParameters) {
    if (!params[requiredParameter]) {
      throw new SDKError(
        new ValidationError(
          `Required parameter "${requiredParameter}" is missing.`
        )
      )
    }
  }

  // Determine if the request is for a gasless relayer service or advanced relayer service
  // We will use the same endpoint for both after the gasless relayer service is deprecated
  const relayerPath = params.typedData.some(
    (t) => t.primaryType === 'PermitWitnessTransferFrom'
  )
    ? '/relayer/relay'
    : '/advanced/relay'

  const result = await request<RelayResponse>(
    config,
    `${config.apiUrl}${relayerPath}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params, (_, value) => {
        if (typeof value === 'bigint') {
          return value.toString()
        }
        return value
      }),
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

/**
 * Get the status of a relayed transaction
 * @param params - Parameters for the relay status request
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Status of the relayed transaction
 */
export const getRelayedTransactionStatus = async (
  config: SDKBaseConfig,
  params: RelayStatusRequest,
  options?: RequestOptions
): Promise<RelayStatusResponseData> => {
  if (!params.taskId) {
    throw new SDKError(
      new ValidationError('Required parameter "taskId" is missing.')
    )
  }

  const { taskId, ...otherParams } = params
  const queryParams = new URLSearchParams(
    otherParams as unknown as Record<string, string>
  )
  const result = await request<RelayStatusResponse>(
    config,
    `${config.apiUrl}/relayer/status/${taskId}?${queryParams}`,
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

/**
 * Get all available chains
 * @param config - The SDK client configuration
 * @param params - The configuration of the requested chains
 * @param options - Request options
 * @returns A list of all available chains
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getChains = async (
  config: SDKBaseConfig,
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
        config,
        `${config.apiUrl}/chains?${urlSearchParams}`,
        {
          signal: options?.signal,
        }
      ),
    { id: `${getChains.name}.${urlSearchParams}` }
  )
  return response.chains
}

/**
 * Get all known tokens.
 * @param config - The SDK client configuration
 * @param params - The configuration of the requested tokens
 * @param options - Request options
 * @returns The tokens that are available on the requested chains
 */
export async function getTokens(
  config: SDKBaseConfig,
  params?: TokensRequest & { extended?: false | undefined },
  options?: RequestOptions
): Promise<TokensResponse>
export async function getTokens(
  config: SDKBaseConfig,
  params: TokensRequest & { extended: true },
  options?: RequestOptions
): Promise<TokensExtendedResponse>
export async function getTokens(
  config: SDKBaseConfig,
  params?: TokensRequest,
  options?: RequestOptions
): Promise<TokensResponse> {
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
  const isExtended = params?.extended === true
  const response = await withDedupe(
    () =>
      request<
        typeof isExtended extends true ? TokensExtendedResponse : TokensResponse
      >(config, `${config.apiUrl}/tokens?${urlSearchParams}`, {
        signal: options?.signal,
      }),
    { id: `${getTokens.name}.${urlSearchParams}` }
  )
  return response
}

/**
 * Fetch information about a Token
 * @param config - The SDK client configuration
 * @param chain - Id or key of the chain that contains the token
 * @param token - Address or symbol of the token on the requested chain
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Token information
 */
export const getToken = async (
  config: SDKBaseConfig,
  chain: ChainKey | ChainId,
  token: string,
  options?: RequestOptions
): Promise<TokenExtended> => {
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
  return await request<TokenExtended>(
    config,
    `${config.apiUrl}/token?${new URLSearchParams({
      chain,
      token,
    } as Record<string, string>)}`,
    {
      signal: options?.signal,
    }
  )
}

/**
 * Get the available tools to bridge and swap tokens.
 * @param config - The SDK client configuration
 * @param params - The configuration of the requested tools
 * @param options - Request options
 * @returns The tools that are available on the requested chains
 */
export const getTools = async (
  config: SDKBaseConfig,
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
    config,
    `${config.apiUrl}/tools?${new URLSearchParams(
      params as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )
}

/**
 * Get gas recommendation for a certain chain
 * @param config - The SDK client configuration
 * @param params - Configuration of the requested gas recommendation.
 * @param options - Request options
 * @throws {LiFiError} Throws a LiFiError if request fails.
 * @returns Gas recommendation response.
 */
export const getGasRecommendation = async (
  config: SDKBaseConfig,
  params: GasRecommendationRequest,
  options?: RequestOptions
): Promise<GasRecommendationResponse> => {
  if (!params.chainId) {
    throw new SDKError(
      new ValidationError('Required parameter "chainId" is missing.')
    )
  }

  const url = new URL(`${config.apiUrl}/gas/suggestion/${params.chainId}`)
  if (params.fromChain) {
    url.searchParams.append('fromChain', params.fromChain as unknown as string)
  }
  if (params.fromToken) {
    url.searchParams.append('fromToken', params.fromToken)
  }

  return await request<GasRecommendationResponse>(config, url.toString(), {
    signal: options?.signal,
  })
}

/**
 * Get all the available connections for swap/bridging tokens
 * @param config - The SDK client configuration
 * @param connectionRequest ConnectionsRequest
 * @param options - Request options
 * @returns ConnectionsResponse
 */
export const getConnections = async (
  config: SDKBaseConfig,
  connectionRequest: ConnectionsRequest,
  options?: RequestOptions
): Promise<ConnectionsResponse> => {
  const url = new URL(`${config.apiUrl}/connections`)

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
  return await request<ConnectionsResponse>(config, url, options)
}

export const getTransactionHistory = async (
  config: SDKBaseConfig,
  { wallet, status, fromTimestamp, toTimestamp }: TransactionAnalyticsRequest,
  options?: RequestOptions
): Promise<TransactionAnalyticsResponse> => {
  if (!wallet) {
    throw new SDKError(
      new ValidationError('Required parameter "wallet" is missing.')
    )
  }

  const url = new URL(`${config.apiUrl}/analytics/transfers`)

  url.searchParams.append('integrator', config.integrator)
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

  return await request<TransactionAnalyticsResponse>(config, url, options)
}
