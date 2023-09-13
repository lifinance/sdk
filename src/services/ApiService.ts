import {
  ConnectionsRequest,
  ConnectionsResponse,
  ContractCallQuoteRequest,
  GasRecommendationRequest,
  GasRecommendationResponse,
  GetStatusRequest,
  LifiStep,
  QuoteRequest,
  RequestOptions,
  TokensRequest,
  TokensResponse,
} from '@lifi/types'
import { request } from '../request'
import { isRoutesRequest, isStep } from '../typeguards'
import {
  ChainId,
  ChainKey,
  ChainsResponse,
  ExtendedChain,
  PossibilitiesRequest,
  PossibilitiesResponse,
  RoutesRequest,
  RoutesResponse,
  StatusResponse,
  Token,
  ToolsRequest,
  ToolsResponse,
} from '../types'
import { ValidationError } from '../utils/errors'
import { parseBackendError } from '../utils/parseError'
import ConfigService from './ConfigService'

/**
 * @deprecated We don't want to support this endpoint anymore in the future. /chains, /tools, /connections, and /tokens should be used instead
 */
const getPossibilities = async (
  requestConfig?: PossibilitiesRequest,
  options?: RequestOptions
): Promise<PossibilitiesResponse> => {
  if (!requestConfig) {
    requestConfig = {}
  }

  const config = ConfigService.getInstance().getConfig()

  // apply defaults
  if (requestConfig.bridges || config.defaultRouteOptions.bridges) {
    requestConfig.bridges =
      requestConfig.bridges || config.defaultRouteOptions.bridges
  }
  if (requestConfig.exchanges || config.defaultRouteOptions.exchanges) {
    requestConfig.exchanges =
      requestConfig.exchanges || config.defaultRouteOptions.exchanges
  }

  // send request
  try {
    const response = await request<PossibilitiesResponse>(
      `${config.apiUrl}/advanced/possibilities`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestConfig),
        signal: options?.signal,
      }
    )
    return response
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getToken = async (
  chain: ChainKey | ChainId,
  token: string,
  options?: RequestOptions
): Promise<Token> => {
  if (!chain) {
    throw new ValidationError('Required parameter "chain" is missing.')
  }

  if (!token) {
    throw new ValidationError('Required parameter "token" is missing.')
  }

  const config = ConfigService.getInstance().getConfig()
  try {
    const response = await request<Token>(
      `${config.apiUrl}/token?${new URLSearchParams({
        chain,
        token,
      } as Record<string, string>)}`,
      {
        signal: options?.signal,
      }
    )

    return response
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getQuote = async (
  requestConfig: QuoteRequest,
  options?: RequestOptions
): Promise<LifiStep> => {
  const config = ConfigService.getInstance().getConfig()

  const requiredParameters: Array<keyof QuoteRequest> = [
    'fromChain',
    'fromToken',
    'fromAddress',
    'fromAmount',
    'toChain',
    'toToken',
  ]
  requiredParameters.forEach((requiredParameter) => {
    if (!requestConfig[requiredParameter]) {
      throw new ValidationError(
        `Required parameter "${requiredParameter}" is missing.`
      )
    }
  })

  // apply defaults
  requestConfig.order ||= config.defaultRouteOptions.order
  requestConfig.slippage ||= config.defaultRouteOptions.slippage
  requestConfig.integrator ||= config.defaultRouteOptions.integrator
  requestConfig.referrer ||= config.defaultRouteOptions.referrer
  requestConfig.fee ||= config.defaultRouteOptions.fee

  requestConfig.allowBridges ||= config.defaultRouteOptions.bridges?.allow
  requestConfig.denyBridges ||= config.defaultRouteOptions.bridges?.deny
  requestConfig.preferBridges ||= config.defaultRouteOptions.bridges?.prefer
  requestConfig.allowExchanges ||= config.defaultRouteOptions.exchanges?.allow
  requestConfig.denyExchanges ||= config.defaultRouteOptions.exchanges?.deny
  requestConfig.preferExchanges ||= config.defaultRouteOptions.exchanges?.prefer

  Object.keys(requestConfig).forEach(
    (key) =>
      !requestConfig[key as keyof QuoteRequest] &&
      delete requestConfig[key as keyof QuoteRequest]
  )

  try {
    const response = await request<LifiStep>(
      `${config.apiUrl}/quote?${new URLSearchParams(
        requestConfig as unknown as Record<string, string>
      )}`,
      {
        signal: options?.signal,
      }
    )

    return response
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getContractCallQuote = async (
  requestConfig: ContractCallQuoteRequest,
  options?: RequestOptions
): Promise<LifiStep> => {
  const config = ConfigService.getInstance().getConfig()

  // validation
  const requiredParameters: Array<keyof ContractCallQuoteRequest> = [
    'fromChain',
    'fromToken',
    'fromAddress',
    'toChain',
    'toToken',
    'toAmount',
    'toContractAddress',
    'toContractCallData',
    'toContractGasLimit',
  ]
  requiredParameters.forEach((requiredParameter) => {
    if (!requestConfig[requiredParameter]) {
      throw new ValidationError(
        `Required parameter "${requiredParameter}" is missing.`
      )
    }
  })

  // apply defaults
  // option.order is not used in this endpoint
  requestConfig.slippage ||= config.defaultRouteOptions.slippage
  requestConfig.integrator ||= config.defaultRouteOptions.integrator
  requestConfig.referrer ||= config.defaultRouteOptions.referrer
  requestConfig.fee ||= config.defaultRouteOptions.fee

  requestConfig.allowBridges ||= config.defaultRouteOptions.bridges?.allow
  requestConfig.denyBridges ||= config.defaultRouteOptions.bridges?.deny
  requestConfig.preferBridges ||= config.defaultRouteOptions.bridges?.prefer
  requestConfig.allowExchanges ||= config.defaultRouteOptions.exchanges?.allow
  requestConfig.denyExchanges ||= config.defaultRouteOptions.exchanges?.deny
  requestConfig.preferExchanges ||= config.defaultRouteOptions.exchanges?.prefer

  // send request
  try {
    const response = await request<LifiStep>(
      `${config.apiUrl}/quote/contractCalls`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestConfig),
        signal: options?.signal,
      }
    )

    return response
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getStatus = async (
  requestConfig: GetStatusRequest,
  options?: RequestOptions
): Promise<StatusResponse> => {
  if (!requestConfig.txHash) {
    throw new ValidationError('Required parameter "txHash" is missing.')
  }

  const config = ConfigService.getInstance().getConfig()
  const queryParams = new URLSearchParams(
    requestConfig as unknown as Record<string, string>
  )
  try {
    const response = await request<StatusResponse>(
      `${config.apiUrl}/status?${queryParams}`,
      {
        signal: options?.signal,
      }
    )

    return response
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getChains = async (
  options?: RequestOptions
): Promise<ExtendedChain[]> => {
  const config = ConfigService.getInstance().getConfig()

  try {
    const response = await request<ChainsResponse>(`${config.apiUrl}/chains`, {
      signal: options?.signal,
    })

    return response.chains
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getRoutes = async (
  requestConfig: RoutesRequest,
  options?: RequestOptions
): Promise<RoutesResponse> => {
  if (!isRoutesRequest(requestConfig)) {
    throw new ValidationError('Invalid routes request.')
  }

  const config = ConfigService.getInstance().getConfig()

  // apply defaults
  requestConfig.options = {
    ...config.defaultRouteOptions,
    ...requestConfig.options,
  }

  // send request
  try {
    const response = await request<RoutesResponse>(
      `${config.apiUrl}/advanced/routes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestConfig),
        signal: options?.signal,
      }
    )

    return response
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getStepTransaction = async (
  step: LifiStep,
  options?: RequestOptions
): Promise<LifiStep> => {
  if (!isStep(step)) {
    // While the validation fails for some users we should not enforce it
    // eslint-disable-next-line no-console
    console.warn('SDK Validation: Invalid Step', step)
  }

  const config = ConfigService.getInstance().getConfig()
  try {
    const response = await request<LifiStep>(
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

    return response
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getTools = async (
  requestConfig?: ToolsRequest,
  options?: RequestOptions
): Promise<ToolsResponse> => {
  const config = ConfigService.getInstance().getConfig()
  if (requestConfig) {
    Object.keys(requestConfig).forEach(
      (key) =>
        !requestConfig[key as keyof ToolsRequest] &&
        delete requestConfig[key as keyof ToolsRequest]
    )
  }
  const response = await request<ToolsResponse>(
    `${config.apiUrl}/tools?${new URLSearchParams(
      requestConfig as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )

  return response
}

const getTokens = async (
  requestConfig?: TokensRequest,
  options?: RequestOptions
): Promise<TokensResponse> => {
  const config = ConfigService.getInstance().getConfig()
  if (requestConfig) {
    Object.keys(requestConfig).forEach(
      (key) =>
        !requestConfig[key as keyof TokensRequest] &&
        delete requestConfig[key as keyof TokensRequest]
    )
  }
  const response = await request<TokensResponse>(
    `${config.apiUrl}/tokens?${new URLSearchParams(
      requestConfig as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )

  return response
}

const getGasRecommendation = async (
  { chainId, fromChain, fromToken }: GasRecommendationRequest,
  options?: RequestOptions
): Promise<GasRecommendationResponse> => {
  const config = ConfigService.getInstance().getConfig()

  if (!chainId) {
    throw new ValidationError('Required parameter "chainId" is missing.')
  }

  const url = new URL(`${config.apiUrl}/gas/suggestion/${chainId}`)
  if (fromChain) {
    url.searchParams.append('fromChain', fromChain as unknown as string)
  }
  if (fromToken) {
    url.searchParams.append('fromToken', fromToken)
  }

  try {
    const response = await request<GasRecommendationResponse>(url, {
      signal: options?.signal,
    })
    return response
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getAvailableConnections = async (
  connectionRequest: ConnectionsRequest
): Promise<ConnectionsResponse> => {
  const config = ConfigService.getInstance().getConfig()

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

  connectionRequestArrayParams.forEach((parameter) => {
    const connectionRequestArrayParam: string[] = connectionRequest[
      parameter
    ] as string[]

    if (connectionRequestArrayParam?.length) {
      connectionRequestArrayParam?.forEach((value) => {
        url.searchParams.append(parameter, value)
      })
    }
  })

  try {
    const response = await request<ConnectionsResponse>(url)
    return response
  } catch (e) {
    throw await parseBackendError(e)
  }
}

export default {
  getChains,
  getContractCallQuote,
  getGasRecommendation,
  getPossibilities,
  getQuote,
  getRoutes,
  getStatus,
  getStepTransaction,
  getToken,
  getTokens,
  getTools,
  getAvailableConnections,
}
