import type { Route } from '@lifi/types'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { LiFiStepExtended } from '../types/core.js'
import type { FundingOrder } from '../types/funding.js'
import { convertQuoteToRoute } from './convertQuoteToRoute.js'

/**
 * Converts a STANDARD funding order into a synthetic route for executeRoute.
 * The route id is the orderId, so execution state and UI map one-to-one.
 * @param order - The funding order holding a committed quote.
 * @returns The route to be executed.
 * @throws {SDKError} ValidationError for non-STANDARD orders or a missing quote.
 */
export const convertOrderToRoute = (order: FundingOrder): Route => {
  if (order.type !== 'STANDARD') {
    throw new SDKError(
      new ValidationError(
        `Only STANDARD funding orders are executable. Order ${order.orderId} is ${order.type}.`
      )
    )
  }
  if (!order.quote) {
    throw new SDKError(
      new ValidationError(`Funding order ${order.orderId} has no quote.`)
    )
  }
  const route = convertQuoteToRoute(order.quote)
  route.id = order.orderId
  const step = route.steps[0] as LiFiStepExtended
  step.fundingOrderId = order.orderId
  return route
}
