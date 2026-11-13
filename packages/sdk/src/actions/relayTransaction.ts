import type {
  RelayRequest,
  RelayResponse,
  RelayResponseData,
  RequestOptions,
} from '@lifi/types'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import { request } from '../utils/request.js'

/**
 * Relay a transaction through the relayer service
 * @param client - The SDK client
 * @param params - The configuration for the relay request
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Task ID and transaction link for the relayed transaction
 */
export const relayTransaction = async (
  client: SDKClient,
  params: RelayRequest,
  options?: RequestOptions
): Promise<RelayResponseData> => {
  const requiredParameters: Array<keyof RelayRequest> = ['typedData']

  for (const requiredParameter of requiredParameters) {
    if (!params[requiredParameter]) {
      throw new SDKError(
        new ValidationError(
          `Required parameter "${requiredParameter}" is missing.`
        )
      )
    }
  }

  const result = await request<RelayResponse>(
    client.config,
    `${client.config.apiUrl}/advanced/relay`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params, (_, value) => {
        if (typeof value === 'bigint') {
          return value.toString()
        }
        return value
      }),
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
