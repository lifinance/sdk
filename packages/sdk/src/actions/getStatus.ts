import type { RequestOptions, StatusResponse } from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { GetStatusRequestExtended } from '../types/actions.js'
import type { SDKClient } from '../types/core.js'
import { request } from '../utils/request.js'

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
  if (
    !('taskId' in params && params.taskId) &&
    !('txHash' in params && params.txHash)
  ) {
    throw new SDKError(
      new ValidationError(
        'Either "taskId" or "txHash" must be provided and non-empty.'
      )
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
