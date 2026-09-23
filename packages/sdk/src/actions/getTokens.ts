import type {
  RequestOptions,
  TokensExtendedResponse,
  TokensRequest,
  TokensResponse,
} from '@lifi/types'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import { request } from '../utils/request.js'
import { withDedupe } from '../utils/withDedupe.js'

/**
 * Get all known tokens.
 * @param client - The SDK client
 * @param params - The configuration of the requested tokens
 * @param options - Request options
 * @returns The tokens that are available on the requested chains
 */
export async function getTokens(
  client: SDKClient,
  params?: TokensRequest & { extended?: false | undefined },
  options?: RequestOptions
): Promise<TokensResponse>
export async function getTokens(
  client: SDKClient,
  params: TokensRequest & { extended: true },
  options?: RequestOptions
): Promise<TokensExtendedResponse>
export async function getTokens(
  client: SDKClient,
  params?: TokensRequest,
  options?: RequestOptions
): Promise<TokensResponse> {
  if (params) {
    for (const key of Object.keys(params)) {
      const value = params[key as keyof TokensRequest]
      if (value === undefined || value === null) {
        delete params[key as keyof TokensRequest]
      }
    }
  }
  const urlSearchParams = new URLSearchParams(
    params as Record<string, string>
  ).toString()
  const _isExtended = params?.extended === true
  const response = await withDedupe(
    (signal) =>
      request<
        typeof _isExtended extends true
          ? TokensExtendedResponse
          : TokensResponse
      >(client.config, `${client.config.apiUrl}/tokens?${urlSearchParams}`, {
        signal,
      }),
    {
      id: `${getTokens.name}.${client.config.apiUrl}.${urlSearchParams}`,
      signal: options?.signal,
    }
  ).catch((error) => {
    // A caller that aborts leaves before the request settles; keep its error
    // shaped like one from `request`.
    throw error instanceof SDKError ? error : new SDKError(error)
  })
  return response
}
