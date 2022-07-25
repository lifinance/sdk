import {
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
  {
    fromChain,
    fromToken,
    fromAddress,
    fromAmount,
    toChain,
    toToken,
    toAddress,
    order,
    slippage,
    integrator,
    referrer,
    allowBridges,
    denyBridges,
    preferBridges,
    allowExchanges,
    denyExchanges,
    preferExchanges,
  }: QuoteRequest,
  options?: RequestOptions
): Promise<Step> => {
  if (!fromChain) {
    throw new ValidationError('Required parameter "fromChain" is missing.')
  }
  if (!fromToken) {
    throw new ValidationError('Required parameter "fromToken" is missing.')
  }
  if (!fromAddress) {
    throw new ValidationError('Required parameter "fromAddress" is missing.')
  }
  if (!fromAmount) {
    throw new ValidationError('Required parameter "fromAmount" is missing.')
  }
  if (!toChain) {
    throw new ValidationError('Required parameter "toChain" is missing.')
  }
  if (!toToken) {
    throw new ValidationError('Required parameter "toToken" is missing.')
  }

  const configService = ConfigService.getInstance()
  const config = configService.getConfig()
  try {
    const result = await axios.get<Step>(config.apiUrl + 'quote', {
      params: {
        fromChain,
        toChain,
        fromToken,
        toToken,
        fromAddress,
        toAddress,
        fromAmount,
        order,
        slippage,
        integrator,
        referrer,
        allowBridges,
        denyBridges,
        preferBridges,
        allowExchanges,
        denyExchanges,
        preferExchanges,
      },
      signal: options?.signal,
    })
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
  getStatus,
  getChains,
  getRoutes,
  getStepTransaction,
  getTools,
  getTokens,
}
