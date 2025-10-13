import type {
  RequestOptions,
  TransactionAnalyticsRequest,
  TransactionAnalyticsResponse,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'

export const getTransactionHistory = async (
  config: SDKBaseConfig,
  { wallet, status, fromTimestamp, toTimestamp }: TransactionAnalyticsRequest,
  options?: RequestOptions
): Promise<TransactionAnalyticsResponse> => {
  if (!wallet) {
    throw new SDKError(
      new ValidationError('Required parameter "wallet" is missing.')
    )
  }

  const url = new URL(`${config.apiUrl}/analytics/transfers`)

  url.searchParams.append('integrator', config.integrator)
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

  return await request<TransactionAnalyticsResponse>(config, url, options)
}
