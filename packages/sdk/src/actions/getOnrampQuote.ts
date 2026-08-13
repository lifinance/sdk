import type { RequestOptions } from '@lifi/types'
import type { SDKClient } from '../types/core.js'
import type { OnrampQuoteRequest, OnrampQuoteResult } from '../types/funding.js'
import { request } from '../utils/request.js'

/**
 * Get an on-ramp fiat quote for a token.
 * @param client - The SDK client
 * @param params - The on-ramp quote request
 * @param options - Request options
 * @throws {SDKError} Throws if the request fails.
 * @returns The on-ramp quote.
 */
export const getOnrampQuote = async (
  client: SDKClient,
  params: OnrampQuoteRequest,
  options?: RequestOptions
): Promise<OnrampQuoteResult> => {
  return await request<OnrampQuoteResult>(
    client.config,
    `${client.config.apiUrl}/funding/onramp/quote`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: options?.signal,
    }
  )
}
