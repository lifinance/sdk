import type {
  RequestOptions,
  SmartDepositsStatusResponse,
  StatusResponse,
} from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type {
  GetStatusRequestExtended,
  SmartDepositsStatusRequest,
} from '../types/actions.js'
import type { SDKClient } from '../types/core.js'
import { request } from '../utils/request.js'

/**
 * Check the status of a transfer. For cross chain transfers, the "bridge" parameter is required.
 * A Smart Deposits transfer can be looked up by "depositAddress" and "fromChain".
 * @param client - The SDK client
 * @param params - Configuration of the requested status
 * @param options - Request options.
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Returns status response.
 */
export async function getStatus(
  client: SDKClient,
  params: SmartDepositsStatusRequest,
  options?: RequestOptions
): Promise<SmartDepositsStatusResponse>
export async function getStatus(
  client: SDKClient,
  params: GetStatusRequestExtended,
  options?: RequestOptions
): Promise<StatusResponse>
export async function getStatus(
  client: SDKClient,
  params: GetStatusRequestExtended | SmartDepositsStatusRequest,
  options?: RequestOptions
): Promise<StatusResponse | SmartDepositsStatusResponse> {
  if (
    !('taskId' in params && params.taskId) &&
    !('txHash' in params && params.txHash) &&
    !(params.depositAddress && params.fromChain)
  ) {
    throw new SDKError(
      new ValidationError(
        'Either "taskId", "txHash" or "depositAddress" with "fromChain" must be provided and non-empty.'
      )
    )
  }
  const queryParams = new URLSearchParams(
    params as unknown as Record<string, string>
  )
  return await request<StatusResponse | SmartDepositsStatusResponse>(
    client.config,
    `${client.config.apiUrl}/status?${queryParams}`,
    {
      signal: options?.signal,
    }
  )
}
