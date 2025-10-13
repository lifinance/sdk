import type {
  ConnectionsRequest,
  ConnectionsResponse,
  RequestOptions,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { request } from '../request.js'

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
