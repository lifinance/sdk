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
  // is a backend contract, not a code guarantee. Two gates would act on it if
  // it ever appeared: EthereumCheckPermitsTask.shouldRun keys on typedData
  // filtered by primaryType === 'Permit', and isRelayerStep is true for any
  // non-empty typedData array. Neither of those two consults skipPermit - the
  // marker set above is read elsewhere, by EthereumNativePermitTask and
  // isPermit2Supported - so setting it is not enough on its own. A contract
  // change would make getEthereumExecutionStrategy answer 'relayed' and bypass
  // the committed transactionRequest entirely. Strip rather than throw: falling
  // back to the committed request is the correct behaviour for a funding order.
  // This call covers construction, and getFundingOrderUpdatedStep drops
  // typedData again on the refresh path, which rebuilds the step from a re-read
  // quote. The two are complementary, not alternatives: stripping only here
  // leaves the refresh path open, and stripping only there is too late for
  // EthereumCheckPermitsTask, which is pipeline task 1 while the prepare task
  // is task 7.
  delete step.typedData
  return route
}
