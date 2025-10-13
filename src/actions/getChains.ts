import type {
  ChainsRequest,
  ChainsResponse,
  ExtendedChain,
  RequestOptions,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { request } from '../request.js'
import { withDedupe } from '../utils/withDedupe.js'

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
