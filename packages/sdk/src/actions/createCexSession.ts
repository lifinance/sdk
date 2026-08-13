import type { RequestOptions } from '@lifi/types'
import type { SDKClient } from '../types/core.js'
import type { CexSessionRequest, CexSessionResult } from '../types/funding.js'
import { request } from '../utils/request.js'

/**
 * Create a CEX session for a token.
 * @param client - The SDK client
 * @param params - The CEX session request
 * @param options - Request options
 * @throws {SDKError} Throws if the request fails.
 * @returns The CEX session.
 */
export const createCexSession = async (
  client: SDKClient,
  params: CexSessionRequest,
  options?: RequestOptions
): Promise<CexSessionResult> => {
  return await request<CexSessionResult>(
    client.config,
    `${client.config.apiUrl}/funding/cex/session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: options?.signal,
    }
  )
}
