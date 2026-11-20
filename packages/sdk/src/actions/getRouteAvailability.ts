import type { RequestOptions, RoutesResponse } from '@lifi/types'
import { ServerError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { RoutesRequest } from '../types/actions.js'
import type { SDKClient } from '../types/core.js'
import { getRoutes } from './getRoutes.js'

/**
 * Quote-time classification of one `getRoutes` response.
 *
 * `ROUTABLE` means the response included at least one route for this exact
 * request. It is not a guarantee the transfer will execute. `NO_ROUTE` means
 * the request succeeded and the route list was empty. A failed request stays
 * `UNKNOWN` with its cause, including validation, auth, not-found, rate limit,
 * abort and server failures. Nothing here is cached, and this does not batch
 * checks across allocations.
 */
export type RouteAvailability =
  | {
      status: 'ROUTABLE'
      response: RoutesResponse
    }
  | {
      status: 'NO_ROUTE'
      response: RoutesResponse
    }
  | {
      status: 'UNKNOWN'
      cause: SDKError
    }

const routesListMissing = () =>
  new SDKError(new ServerError('Route response did not include a routes list.'))

export const getRouteAvailability = async (
  client: SDKClient,
  params: RoutesRequest,
  options?: RequestOptions
): Promise<RouteAvailability> => {
  let response: RoutesResponse
  try {
    response = await getRoutes(client, params, options)
  } catch (error) {
    if (error instanceof SDKError) {
      return { status: 'UNKNOWN', cause: error }
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Route availability check failed.'
    return {
      status: 'UNKNOWN',
      cause: new SDKError(new ServerError(message)),
    }
  }

  if (!Array.isArray(response?.routes)) {
    return { status: 'UNKNOWN', cause: routesListMissing() }
  }

  if (response.routes.length === 0) {
    return { status: 'NO_ROUTE', response }
  }

  return { status: 'ROUTABLE', response }
}
