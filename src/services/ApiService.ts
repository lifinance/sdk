import {
  ContractCallQuoteRequest,
  GetStatusRequest,
  QuoteRequest,
  RequestOptions,
  TokensRequest,
  TokensResponse,
} from '@lifi/types'
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
  Step,
  Token,
  ToolsRequest,
  ToolsResponse,
} from '../types'
import { HTTPError, ValidationError } from '../utils/errors'
import { parseBackendError } from '../utils/parseError'
import { sleep } from '../utils/utils'
import ConfigService from './ConfigService'

const lifiFetch = async (
  url: string,
  options: RequestInit,
  retries = 1
): Promise<Response> => {
  try {
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new HTTPError(response)
    }
    return response
  } catch (error) {
    if (retries > 0 && (error as HTTPError)?.status === 500) {
      await sleep(500)
      return lifiFetch(url, options, retries - 1)
    }
    throw error
  }
}

const getPossibilities = async (
  request?: PossibilitiesRequest,
  options?: RequestOptions
): Promise<PossibilitiesResponse> => {
  if (!request) {
    request = {}
  }

  const config = ConfigService.getInstance().getConfig()

  // apply defaults
  if (request.bridges || config.defaultRouteOptions.bridges) {
    request.bridges = request.bridges || config.defaultRouteOptions.bridges
  }
  if (request.exchanges || config.defaultRouteOptions.exchanges) {
    request.exchanges =
      request.exchanges || config.defaultRouteOptions.exchanges
  }

  // send request
  try {
    const response = await lifiFetch(
      `${config.apiUrl}/advanced/possibilities`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: options?.signal,
      }
    )
    const data: PossibilitiesResponse = await response.json()
    return data
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
    const response = await fetch(
      `${config.apiUrl}/token?${new URLSearchParams({
        chain,
        token,
      } as Record<string, string>)}`,
      {
        signal: options?.signal,
      }
    )
    if (!response.ok) {
      throw new HTTPError(response)
    }
    const data: Token = await response.json()
    return data
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getQuote = async (
  request: QuoteRequest,
  options?: RequestOptions
): Promise<Step> => {
  const config = ConfigService.getInstance().getConfig()

  // validation
  const requiredParameters: Array<keyof QuoteRequest> = [
    'fromChain',
    'fromToken',
    'fromAddress',
    'fromAmount',
    'toChain',
    'toToken',
  ]
  requiredParameters.forEach((requiredParameter) => {
    if (!request[requiredParameter]) {
      throw new ValidationError(
        `Required parameter "${requiredParameter}" is missing.`
      )
    }
  })

  // apply defaults
  request.order = request.order || config.defaultRouteOptions.order
  request.slippage = request.slippage || config.defaultRouteOptions.slippage
  request.integrator =
    request.integrator || config.defaultRouteOptions.integrator
  request.referrer = request.referrer || config.defaultRouteOptions.referrer
  request.fee = request.fee || config.defaultRouteOptions.fee

  request.allowBridges =
    request.allowBridges || config.defaultRouteOptions.bridges?.allow
  request.denyBridges =
    request.denyBridges || config.defaultRouteOptions.bridges?.deny
  request.preferBridges =
    request.preferBridges || config.defaultRouteOptions.bridges?.prefer
  request.allowExchanges =
    request.allowExchanges || config.defaultRouteOptions.exchanges?.allow
  request.denyExchanges =
    request.denyExchanges || config.defaultRouteOptions.exchanges?.deny
  request.preferExchanges =
    request.preferExchanges || config.defaultRouteOptions.exchanges?.prefer

  Object.keys(request).forEach(
    (key) =>
      !request[key as keyof QuoteRequest] &&
      delete request[key as keyof QuoteRequest]
  )

  try {
    const response = await fetch(
      `${config.apiUrl}/quote?${new URLSearchParams(
        request as unknown as Record<string, string>
      )}`,
      {
        signal: options?.signal,
      }
    )
    if (!response.ok) {
      throw new HTTPError(response)
    }
    const data: Step = await response.json()
    return data
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getContractCallQuote = async (
  request: ContractCallQuoteRequest,
  options?: RequestOptions
): Promise<Step> => {
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
    if (!request[requiredParameter]) {
      throw new ValidationError(
        `Required parameter "${requiredParameter}" is missing.`
      )
    }
  })

  // apply defaults
  // option.order is not used in this endpoint
  request.slippage = request.slippage || config.defaultRouteOptions.slippage
  request.integrator =
    request.integrator || config.defaultRouteOptions.integrator
  request.referrer = request.referrer || config.defaultRouteOptions.referrer
  request.fee = request.fee || config.defaultRouteOptions.fee

  request.allowBridges =
    request.allowBridges || config.defaultRouteOptions.bridges?.allow
  request.denyBridges =
    request.denyBridges || config.defaultRouteOptions.bridges?.deny
  request.preferBridges =
    request.preferBridges || config.defaultRouteOptions.bridges?.prefer
  request.allowExchanges =
    request.allowExchanges || config.defaultRouteOptions.exchanges?.allow
  request.denyExchanges =
    request.denyExchanges || config.defaultRouteOptions.exchanges?.deny
  request.preferExchanges =
    request.preferExchanges || config.defaultRouteOptions.exchanges?.prefer

  // send request
  try {
    const response = await fetch(`${config.apiUrl}/quote/contractCall`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: options?.signal,
    })
    if (!response.ok) {
      throw new HTTPError(response)
    }
    const data: Step = await response.json()
    return data
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getStatus = async (
  { bridge, fromChain, toChain, txHash }: GetStatusRequest,
  options?: RequestOptions
): Promise<StatusResponse> => {
  if (fromChain !== toChain && !bridge) {
    throw new ValidationError(
      'Parameter "bridge" is required for cross chain transfers.'
    )
  }

  if (!fromChain) {
    throw new ValidationError('Required parameter "fromChain" is missing.')
  }

  if (!toChain) {
    throw new ValidationError('Required parameter "toChain" is missing.')
  }

  if (!txHash) {
    throw new ValidationError('Required parameter "txHash" is missing.')
  }

  const config = ConfigService.getInstance().getConfig()
  try {
    const response = await fetch(
      `${config.apiUrl}/status?${new URLSearchParams({
        bridge,
        fromChain,
        toChain,
        txHash,
      } as Record<string, string>)}`,
      {
        signal: options?.signal,
      }
    )
    if (!response.ok) {
      throw new HTTPError(response)
    }
    const data: StatusResponse = await response.json()
    return data
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getChains = async (
  options?: RequestOptions
): Promise<ExtendedChain[]> => {
  const config = ConfigService.getInstance().getConfig()

  try {
    const response = await fetch(`${config.apiUrl}/chains`, {
      signal: options?.signal,
    })
    if (!response.ok) {
      throw new HTTPError(response)
    }
    const data: ChainsResponse = await response.json()
    return data.chains
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getRoutes = async (
  request: RoutesRequest,
  options?: RequestOptions
): Promise<RoutesResponse> => {
  if (!isRoutesRequest(request)) {
    throw new ValidationError('Invalid routes request.')
  }

  const config = ConfigService.getInstance().getConfig()

  // apply defaults
  request.options = {
    ...config.defaultRouteOptions,
    ...request.options,
  }

  // send request
  try {
    const response = await fetch(`${config.apiUrl}/advanced/routes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: options?.signal,
    })
    if (!response.ok) {
      throw new HTTPError(response)
    }
    const data: RoutesResponse = await response.json()
    return data
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getStepTransaction = async (
  step: Step,
  options?: RequestOptions
): Promise<Step> => {
  if (!isStep(step)) {
    // While the validation fails for some users we should not enforce it
    // eslint-disable-next-line no-console
    console.warn('SDK Validation: Invalid Step', step)
  }

  const config = ConfigService.getInstance().getConfig()
  try {
    const response = await fetch(`${config.apiUrl}/advanced/stepTransaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(step),
      signal: options?.signal,
    })
    if (!response.ok) {
      throw new HTTPError(response)
    }
    const data: Step = await response.json()
    return data
  } catch (e) {
    throw await parseBackendError(e)
  }
}

const getTools = async (
  request?: ToolsRequest,
  options?: RequestOptions
): Promise<ToolsResponse> => {
  const config = ConfigService.getInstance().getConfig()
  if (request) {
    Object.keys(request).forEach(
      (key) =>
        !request[key as keyof ToolsRequest] &&
        delete request[key as keyof ToolsRequest]
    )
  }
  const response = await fetch(
    `${config.apiUrl}/tools?${new URLSearchParams(
      request as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )
  if (!response.ok) {
    throw new HTTPError(response)
  }
  const data: ToolsResponse = await response.json()
  return data
}

const getTokens = async (
  request?: TokensRequest,
  options?: RequestOptions
): Promise<TokensResponse> => {
  const config = ConfigService.getInstance().getConfig()
  if (request) {
    Object.keys(request).forEach(
      (key) =>
        !request[key as keyof TokensRequest] &&
        delete request[key as keyof TokensRequest]
    )
  }
  const response = await fetch(
    `${config.apiUrl}/tokens?${new URLSearchParams(
      request as Record<string, string>
    )}`,
    {
      signal: options?.signal,
    }
  )
  if (!response.ok) {
    throw new HTTPError(response)
  }
  const data: TokensResponse = await response.json()
  return data
}

export default {
  getPossibilities,
  getToken,
  getQuote,
  getContractCallQuote,
  getStatus,
  getChains,
  getRoutes,
  getStepTransaction,
  getTools,
  getTokens,
}
