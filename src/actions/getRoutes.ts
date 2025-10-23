import type { RequestOptions, RoutesRequest, RoutesResponse } from '@lifi/types'
import type { SDKClient } from '../core/types.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from '../request.js'
import { isRoutesRequest } from '../typeguards.js'

/**
 * Get a set of routes for a request that describes a transfer of tokens.
 * @param client - The SDK client.
 * @param params - A description of the transfer.
 * @param options - Request options
 * @returns The resulting routes that can be used to realize the described transfer of tokens.
 * @throws {LiFiError} Throws a LiFiError if request fails.
 */
export const getRoutes = async (
  client: SDKClient,
  params: RoutesRequest,
  options?: RequestOptions
): Promise<RoutesResponse> => {
  if (!isRoutesRequest(params)) {
    throw new SDKError(new ValidationError('Invalid routes request.'))
  }
  // apply defaults
  params.options = {
    integrator: client.config.integrator,
    ...client.config.routeOptions,
    ...params.options,
  }

  return await request<RoutesResponse>(
    client.config,
    `${client.config.apiUrl}/advanced/routes`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      signal: options?.signal,
    }
  )
}
