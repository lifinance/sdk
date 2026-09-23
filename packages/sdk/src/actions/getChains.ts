import type {
  ChainsRequest,
  ChainsResponse,
  ExtendedChain,
  RequestOptions,
} from '@lifi/types'
import { SDKError } from '../errors/SDKError.js'
import type { SDKBaseConfig, SDKClient } from '../types/core.js'
import { request } from '../utils/request.js'
import { withDedupe } from '../utils/withDedupe.js'

/**
 * Get all available chains
 * @param client - The SDK client
 * @param params - The configuration of the requested chains
 * @param options - Request options
 * @returns A list of all available chains
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getChains = async (
  client: SDKClient,
  params?: ChainsRequest,
  options?: RequestOptions
): Promise<ExtendedChain[]> => {
  return await _getChains(client.config, params, options)
}

export const _getChains = async (
  config: SDKBaseConfig,
  params?: ChainsRequest,
  options?: RequestOptions
): Promise<ExtendedChain[]> => {
  if (params) {
    for (const key of Object.keys(params)) {
      const value = params[key as keyof ChainsRequest]
      if (value === undefined || value === null) {
        delete params[key as keyof ChainsRequest]
      }
    }
  }
  const urlSearchParams = new URLSearchParams(
    params as Record<string, string>
  ).toString()
  const response = await withDedupe(
    (signal) =>
      request<ChainsResponse>(
        config,
        `${config.apiUrl}/chains?${urlSearchParams}`,
        {
          signal,
        }
      ),
    {
      id: `${getChains.name}.${config.apiUrl}.${urlSearchParams}`,
      signal: options?.signal,
    }
  ).catch((error) => {
    // A caller that aborts leaves before the request settles; keep its error
    // shaped like one from `request`.
    throw error instanceof SDKError ? error : new SDKError(error)
  })
  return response.chains
}
