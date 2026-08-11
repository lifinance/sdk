import type { RequestOptions } from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import type {
  CreateFundingOrderRequest,
  FundingOrder,
} from '../types/funding.js'
import { request } from '../utils/request.js'

/**
 * Create a funding order. The response embeds the committed quote.
 * 200 (idempotent replay) and 201 (created) both resolve to the order.
 * @param client - The SDK client
 * @param params - The funding order creation request
 * @param options - Request options
 * @throws {SDKError} 422 wraps LiFiErrorCode.TransactionConflict (partnerOrderId reuse with a different body), 424 wraps ThirdPartyError (on-ramp provider outage), 401 wraps ValidationError (keyless ONRAMP).
 * @returns The created (or replayed) funding order.
 */
export const createFundingOrder = async (
  client: SDKClient,
  params: CreateFundingOrderRequest,
  options?: RequestOptions
): Promise<FundingOrder> => {
  if (!params.partnerOrderId) {
    throw new SDKError(
      new ValidationError('Required parameter "partnerOrderId" is missing.')
    )
  }
  return await request<FundingOrder>(
    client.config,
    `${client.config.apiUrl}/funding/orders`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: options?.signal,
    }
  )
}
