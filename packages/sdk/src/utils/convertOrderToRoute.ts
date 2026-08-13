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
  // Clone before marking: convertQuoteToRoute puts the quote into steps[0] by
  // reference, so writing the markers would pollute the caller's order.
  const route = convertQuoteToRoute(structuredClone(order.quote))
  route.id = order.orderId
  const step = route.steps[0] as LiFiStepExtended
  step.fundingOrderId = order.orderId
  // A funding order can never use permit: transactionRequest is committed at
  // order creation and targets estimate.approvalAddress.
  step.estimate.skipPermit = true
  // Defence in depth, not an expected path. The backend refuses `gasless` on a
  // funding quote today, so a funding quote never carries typedData - but that
  // is a backend contract, not a code guarantee. Nothing downstream consults
  // skipPermit: EthereumCheckPermitsTask.shouldRun keys on typedData filtered
  // by primaryType === 'Permit', and isRelayerStep is !!step.typedData?.length.
  // So if the contract ever changed, getEthereumExecutionStrategy would answer
  // 'relayed' and bypass the committed transactionRequest entirely. Strip here
  // rather than throw: falling back to the committed request is the correct
  // behaviour for a funding order, and this is the only choke point early
  // enough - EthereumCheckPermitsTask is pipeline task 1, the prepare task is
  // task 7, so clearing it in getFundingOrderUpdatedStep would be too late.
  delete step.typedData
  return route
}
