import {
  ContractCallQuoteRequest,
  GetStatusRequest,
  QuoteRequest,
  RequestOptions,
  TokensRequest,
  TokensResponse,
} from '@lifi/types'
import axios from 'axios'
import { isRoutesRequest, isStep } from '../typeguards'
import {
  Chain,
  ChainId,
  ChainKey,
  ChainsResponse,
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
import { ValidationError } from '../utils/errors'
import { parseBackendError } from '../utils/parseError'
import ConfigService from './ConfigService'

const getPossibilities = async (
  request?: PossibilitiesRequest,
  options?: RequestOptions
): Promise<PossibilitiesResponse> => {
  if (!request) {
    request = {}
  }

  const configService = ConfigService.getInstance()
  const config = configService.getConfig()

  // apply defaults
  request.bridges = request.bridges || config.defaultRouteOptions.bridges
  request.exchanges = request.exchanges || config.defaultRouteOptions.exchanges

  // send request
  try {
    const result = await axios.post<PossibilitiesResponse>(
      config.apiUrl + 'advanced/possibilities',
      request,
      {
        signal: options?.signal,
      }
    )
    return result.data
  } catch (e) {
    throw parseBackendError(e)
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

  const configService = ConfigService.getInstance()
  const config = configService.getConfig()
  try {
    const result = await axios.get<Token>(config.apiUrl + 'token', {
      params: {
        chain,
        token,
      },
      signal: options?.signal,
    })
    return result.data
  } catch (e) {
    throw parseBackendError(e)
  }
}

const getQuote = async (
  request: QuoteRequest,
  options?: RequestOptions
): Promise<Step> => {
  const configService = ConfigService.getInstance()
  const config = configService.getConfig()

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
    request.allowExchanges || config.defaultRouteOptions.bridges?.allow
  request.denyExchanges =
    request.denyExchanges || config.defaultRouteOptions.bridges?.deny
  request.preferExchanges =
    request.preferExchanges || config.defaultRouteOptions.bridges?.prefer

  try {
    const result = await axios.get<Step>(config.apiUrl + 'quote', {
      params: request,
      signal: options?.signal,
    })
    return result.data
  } catch (e) {
    throw parseBackendError(e)
  }
}

const getContractCallQuote = async (
  request: ContractCallQuoteRequest,
  options?: RequestOptions
): Promise<Step> => {
  const configService = ConfigService.getInstance()
  const config = configService.getConfig()

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
    request.allowExchanges || config.defaultRouteOptions.bridges?.allow
  request.denyExchanges =
    request.denyExchanges || config.defaultRouteOptions.bridges?.deny
  request.preferExchanges =
    request.preferExchanges || config.defaultRouteOptions.bridges?.prefer

  // send request
  try {
    const result = await axios.post<Step>(
      config.apiUrl + 'quoteContractCall',
      request,
      {
        signal: options?.signal,
      }
    )
    return result.data
  } catch (e) {
    throw parseBackendError(e)
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

  const configService = ConfigService.getInstance()
  const config = configService.getConfig()
  try {
    const result = await axios.get<StatusResponse>(config.apiUrl + 'status', {
      params: {
        bridge,
        fromChain,
        toChain,
        txHash,
      },
      signal: options?.signal,
    })
    return result.data
  } catch (e) {
    throw parseBackendError(e)
  }
}

const getChains = async (options?: RequestOptions): Promise<Chain[]> => {
  const configService = ConfigService.getInstance()
  const config = configService.getConfig()

  try {
    const result = await axios.get<ChainsResponse>(config.apiUrl + 'chains', {
      signal: options?.signal,
    })
    return result.data.chains
  } catch (e) {
    throw parseBackendError(e)
  }
}

const getRoutes = async (
  request: RoutesRequest,
  options?: RequestOptions
): Promise<RoutesResponse> => {
  if (!isRoutesRequest(request)) {
    throw new ValidationError('Invalid routes request.')
  }

  const configService = ConfigService.getInstance()
  const config = configService.getConfig()

  // apply defaults
  request.options = {
    ...config.defaultRouteOptions,
    ...request.options,
  }

  // send request
  try {
    const result = await axios.post<RoutesResponse>(
      config.apiUrl + 'advanced/routes',
      request,
      {
        signal: options?.signal,
      }
    )
    return result.data
  } catch (e) {
    throw parseBackendError(e)
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

  const configService = ConfigService.getInstance()
  const config = configService.getConfig()
  try {
    const result = await axios.post<Step>(
      config.apiUrl + 'advanced/stepTransaction',
      step,
      {
        signal: options?.signal,
      }
    )
    return result.data
  } catch (e) {
    throw parseBackendError(e)
  }
}

const getTools = async (
  request?: ToolsRequest,
  options?: RequestOptions
): Promise<ToolsResponse> => {
  const configService = ConfigService.getInstance()
  const config = configService.getConfig()
  const r = await axios.get<ToolsResponse>(config.apiUrl + 'tools', {
    params: request,
    signal: options?.signal,
  })
  return r.data
}

const getTokens = async (
  request?: TokensRequest,
  options?: RequestOptions
): Promise<TokensResponse> => {
  const configService = ConfigService.getInstance()
  const config = configService.getConfig()
  const r = await axios.get<TokensResponse>(config.apiUrl + 'tokens', {
    params: request,
    signal: options?.signal,
  })
  return r.data
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
