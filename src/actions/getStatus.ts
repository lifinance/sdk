import type { RequestOptions, StatusResponse } from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'
import type { GetStatusRequestExtended } from '../types/actions.js'

/**
 * Check the status of a transfer. For cross chain transfers, the "bridge" parameter is required.
 * @param client - The SDK client
 * @param params - Configuration of the requested status
 * @param options - Request options.
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Returns status response.
 */
export const getStatus = async (
  client: SDKClient,
  params: GetStatusRequestExtended,
  options?: RequestOptions
): Promise<StatusResponse> => {
  if (!params.txHash) {
    throw new SDKError(
      new ValidationError('Required parameter "txHash" is missing.')
    )
  }
  const queryParams = new URLSearchParams(
    params as unknown as Record<string, string>
  )
  return await request<StatusResponse>(
    client.config,
    `${client.config.apiUrl}/status?${queryParams}`,
    {
      signal: options?.signal,
    }
  )
}
