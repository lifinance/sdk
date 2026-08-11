import type { RequestOptions } from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import type { FundingOrder, GetFundingOrderParams } from '../types/funding.js'
import { request } from '../utils/request.js'

/**
 * Get a funding order by orderId (or partnerOrderId within the caller's scope).
 * Passing txHash reports the source transaction for a STANDARD, non-terminal order.
 * @param client - The SDK client
 * @param orderId - The orderId (UUID) or partnerOrderId
 * @param params - Optional txHash / integrator query parameters
 * @param options - Request options
 * @throws {SDKError} Throws if the request fails.
 * @returns The funding order.
 */
export const getFundingOrder = async (
  client: SDKClient,
  orderId: string,
  params?: GetFundingOrderParams,
  options?: RequestOptions
): Promise<FundingOrder> => {
  if (!orderId) {
    throw new SDKError(
      new ValidationError('Required parameter "orderId" is missing.')
    )
  }
  const queryParams = new URLSearchParams()
  if (params?.txHash) {
    queryParams.set('txHash', params.txHash)
  }
  if (params?.integrator) {
    queryParams.set('integrator', params.integrator)
  }
  const query = queryParams.size ? `?${queryParams}` : ''
  return await request<FundingOrder>(
    client.config,
    `${client.config.apiUrl}/funding/orders/${encodeURIComponent(orderId)}${query}`,
    {
      signal: options?.signal,
    }
  )
}
