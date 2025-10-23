import type {
  RelayRequest,
  RelayResponse,
  RelayResponseData,
  RequestOptions,
} from '@lifi/types'
import type { SDKBaseConfig } from '../core/types.js'
import { BaseError } from '../errors/baseError.js'
import { ErrorName } from '../errors/constants.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'

/**
 * Relay a transaction through the relayer service
 * @param config - The SDK client configuration
 * @param params - The configuration for the relay request
 * @param options - Request options
 * @throws {LiFiError} - Throws a LiFiError if request fails
 * @returns Task ID and transaction link for the relayed transaction
 */
export const relayTransaction = async (
  config: SDKBaseConfig,
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

  // Determine if the request is for a gasless relayer service or advanced relayer service
  // We will use the same endpoint for both after the gasless relayer service is deprecated
  const relayerPath = params.typedData.some(
    (t) => t.primaryType === 'PermitWitnessTransferFrom'
  )
    ? '/relayer/relay'
    : '/advanced/relay'

  const result = await request<RelayResponse>(
    config,
    `${config.apiUrl}${relayerPath}`,
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
