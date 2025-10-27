import type {
  GasRecommendationRequest,
  GasRecommendationResponse,
  RequestOptions,
} from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import { request } from '../utils/request.js'

/**
 * Get gas recommendation for a certain chain
 * @param client - The SDK client
 * @param params - Configuration of the requested gas recommendation.
 * @param options - Request options
 * @throws {LiFiError} Throws a LiFiError if request fails.
 * @returns Gas recommendation response.
 */
export const getGasRecommendation = async (
  client: SDKClient,
  params: GasRecommendationRequest,
  options?: RequestOptions
): Promise<GasRecommendationResponse> => {
  if (!params.chainId) {
    throw new SDKError(
      new ValidationError('Required parameter "chainId" is missing.')
    )
  }

  const url = new URL(
    `${client.config.apiUrl}/gas/suggestion/${params.chainId}`
  )
  if (params.fromChain) {
    url.searchParams.append('fromChain', params.fromChain as unknown as string)
  }
  if (params.fromToken) {
    url.searchParams.append('fromToken', params.fromToken)
  }

  return await request<GasRecommendationResponse>(
    client.config,
    url.toString(),
    {
      signal: options?.signal,
    }
  )
}
