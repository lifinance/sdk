import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import type {
  FundingOrder,
  WaitForFundingOrderOptions,
} from '../types/funding.js'
import { sleep } from '../utils/sleep.js'
import { getFundingOrder } from './getFundingOrder.js'

/**
 * Poll a funding order until it reaches a terminal state (DONE or FAILED).
 * Non-terminal reads trigger a backend-side refresh — keep the interval >= 10s.
 * @param client - The SDK client
 * @param orderId - The orderId to poll
 * @param options - Polling interval, timeout, and transition callback
 * @throws {SDKError} Wraps TransactionError(LiFiErrorCode.Timeout) when the timeout elapses. The order stays PENDING and can be waited on again.
 * @returns The terminal funding order.
 */
export const waitForFundingOrder = async (
  client: SDKClient,
  orderId: string,
  options?: WaitForFundingOrderOptions
): Promise<FundingOrder> => {
  const pollingInterval = options?.pollingInterval ?? 10_000
  const timeout = options?.timeout ?? 1_200_000
  const deadline = Date.now() + timeout
  let previous: FundingOrder | undefined
  while (true) {
    const order = await getFundingOrder(client, orderId).catch(
      () => undefined
    )
    if (order) {
      const transitioned =
        previous?.status !== order.status ||
        previous?.substatus !== order.substatus
      if (transitioned) {
        options?.onUpdate?.(order)
      }
      previous = order
      if (order.status === 'DONE' || order.status === 'FAILED') {
        return order
      }
    }
    if (Date.now() >= deadline) {
      throw new SDKError(
        new TransactionError(
          LiFiErrorCode.Timeout,
          `Funding order ${orderId} did not reach a terminal state within ${timeout}ms.`
        )
      )
    }
    await sleep(pollingInterval)
  }
}
