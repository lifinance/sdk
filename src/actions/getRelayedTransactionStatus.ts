import type {
  RelayStatusRequest,
  RelayStatusResponse,
  RelayStatusResponseData,
  RequestOptions,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'

/**
 * Get the status of a relayed transaction
 * @param config - The SDK client configuration
 * @param params - Parameters for the relay status request
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Status of the relayed transaction
 */
export const getRelayedTransactionStatus = async (
  config: SDKBaseConfig,
  params: RelayStatusRequest,
  options?: RequestOptions
): Promise<RelayStatusResponseData> => {
  if (!params.taskId) {
    throw new SDKError(
      new ValidationError('Required parameter "taskId" is missing.')
    )
  }

  const { taskId, ...otherParams } = params
  const queryParams = new URLSearchParams(
    otherParams as unknown as Record<string, string>
  )
  const result = await request<RelayStatusResponse>(
    config,
    `${config.apiUrl}/relayer/status/${taskId}?${queryParams}`,
    {
      signal: options?.signal,
    }
  )

  if (result.status === 'error') {
    throw new BaseError(
      ErrorName.ServerError,
      result.data.code,
      result.data.message
    )
  }

  return result.data
}
