import type {
  RequestOptions,
  TokensExtendedResponse,
  TokensRequest,
  TokensResponse,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { request } from '../request.js'
import { withDedupe } from '../utils/withDedupe.js'

/**
 * Get all known tokens.
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
