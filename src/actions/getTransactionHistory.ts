import type {
  RequestOptions,
  TransactionAnalyticsRequest,
  TransactionAnalyticsResponse,
} from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { ValidationError } from '../errors/errors.js'
import { request } from '../request.js'

/**
 * Get the transaction history for a wallet
 * @param client - The SDK client
 * @param params - The parameters for the transaction history request
 * @param params.wallet - The wallet address
 * @param params.status - The status of the transactions
 * @param params.fromTimestamp - The start timestamp for the transactions
 * @param params.toTimestamp - The end timestamp for the transactions
 * @param options - Request options
 * @throws {ValidationError} - Throws a ValidationError if parameters are invalid
 * @throws {LiFiError} - Throws a LiFiError if request fails.
 * @returns The transaction history response
 */
export const getTransactionHistory = async (
  client: SDKClient,
  { wallet, status, fromTimestamp, toTimestamp }: TransactionAnalyticsRequest,
  options?: RequestOptions
): Promise<TransactionAnalyticsResponse> => {
  if (!wallet) {
    throw new ValidationError('Required parameter "wallet" is missing.')
  }

  const url = new URL(`${client.config.apiUrl}/analytics/transfers`)

  url.searchParams.append('integrator', client.config.integrator)
  url.searchParams.append('wallet', wallet)

  if (status) {
    url.searchParams.append('status', status)
  }

  if (fromTimestamp) {
    url.searchParams.append('fromTimestamp', fromTimestamp.toString())
  }

  if (toTimestamp) {
    url.searchParams.append('toTimestamp', toTimestamp.toString())
  }

  return await request<TransactionAnalyticsResponse>(
    client.config,
    url,
    options
  )
}
