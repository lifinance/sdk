import type {
  RelayStatusRequest,
  RelayStatusResponse,
  RelayStatusResponseData,
  RequestOptions,
} from '@lifi/types'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'
import type { SDKClient } from '../types/core.js'
import { decodeTaskId } from '../utils/decode.js'
import { getStatus } from './getStatus.js'

/**
 * Get the status of a relayed transaction
 * @param client - The SDK client
 * @param params - Parameters for the relay status request
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Status of the relayed transaction
 */
export const getRelayedTransactionStatus = async (
  client: SDKClient,
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

  const decodedTaskId = decodeTaskId(taskId)
  // Temporary solution during the transition between status endpoints
  if (decodedTaskId.length === 3) {
    return (await getStatus(
      client,
      params,
      options
    )) as unknown as RelayStatusResponseData
  }

  const result = await request<RelayStatusResponse>(
    client.config,
    `${client.config.apiUrl}/relayer/status/${taskId}?${queryParams}`,
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
