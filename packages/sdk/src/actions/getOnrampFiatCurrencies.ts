import type { RequestOptions } from '@lifi/types'
import type { SDKClient } from '../types/core.js'
import type {
  OnrampFiatCurrenciesRequest,
  OnrampFiatCurrenciesResult,
} from '../types/funding.js'
import { request } from '../utils/request.js'

/**
 * Get available fiat currencies for an on-ramp token.
 * @param client - The SDK client
 * @param params - The on-ramp fiat currencies request
 * @param options - Request options
 * @throws {SDKError} Throws if the request fails.
 * @returns The available fiat currencies.
 */
export const getOnrampFiatCurrencies = async (
  client: SDKClient,
  params: OnrampFiatCurrenciesRequest,
  options?: RequestOptions
): Promise<OnrampFiatCurrenciesResult> => {
  return await request<OnrampFiatCurrenciesResult>(
    client.config,
    `${client.config.apiUrl}/funding/onramp/fiat-currencies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: options?.signal,
    }
  )
}
