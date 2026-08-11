import type { RequestOptions } from '@lifi/types'
import type { SDKClient } from '../types/core.js'
import type {
  OnrampSessionRequest,
  OnrampSessionResult,
} from '../types/funding.js'
import { request } from '../utils/request.js'

/**
 * Create an on-ramp session for a token.
 * @param client - The SDK client
 * @param params - The on-ramp session request
 * @param options - Request options
 * @throws {SDKError} Throws if the request fails.
 * @returns The on-ramp session.
 */
export const createOnrampSession = async (
  client: SDKClient,
  params: OnrampSessionRequest,
  options?: RequestOptions
): Promise<OnrampSessionResult> => {
  return await request<OnrampSessionResult>(
    client.config,
    `${client.config.apiUrl}/funding/onramp/session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: options?.signal,
    }
  )
}
