import type {
  ChainId,
  ChainKey,
  RequestOptions,
  TokenExtended,
} from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import { request } from '../utils/request.js'

/**
 * Fetch information about a Token
 * @param client - The SDK client
 * @param chain - Id or key of the chain that contains the token
 * @param token - Address or symbol of the token on the requested chain
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Token information
 */
export const getToken = async (
  client: SDKClient,
  chain: ChainKey | ChainId,
  token: string,
  options?: RequestOptions
): Promise<TokenExtended> => {
  if (!chain) {
    throw new SDKError(
      new ValidationError('Required parameter "chain" is missing.')
    )
  }
  if (!token) {
    throw new SDKError(
      new ValidationError('Required parameter "token" is missing.')
    )
  }
  return await request<TokenExtended>(
    client.config,
    `${client.config.apiUrl}/token?${new URLSearchParams({
      chain,
      token,
    } as Record<string, string>)}`,
    {
      signal: options?.signal,
    }
  )
}
