import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError, ValidationError } from '../errors/errors.js'
import { HTTPError } from '../errors/httpError.js'
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
 * @throws {SDKError} ValidationError when orderId is missing. Wraps TransactionError(LiFiErrorCode.Timeout) when the timeout elapses. The order stays PENDING and can be waited on again. Also rejects immediately on client errors (HTTP 400, 401, 404, 422); other failures retry until the timeout.
 * @returns The terminal funding order.
 */
export const waitForFundingOrder = async (
  client: SDKClient,
  orderId: string,
  options?: WaitForFundingOrderOptions
): Promise<FundingOrder> => {
  if (!orderId) {
    throw new SDKError(
      new ValidationError('Required parameter "orderId" is missing.')
    )
  }
  const pollingInterval = options?.pollingInterval ?? 10_000
  const timeout = options?.timeout ?? 1_200_000
  const deadline = Date.now() + timeout
  let previous: FundingOrder | undefined
  while (true) {
    const order = await getFundingOrder(client, orderId).catch(
      (error: unknown) => {
        const cause = (error as SDKError).cause
        if (
          cause instanceof HTTPError &&
          (cause.status === 400 ||
            cause.status === 401 ||
            cause.status === 404 ||
            cause.status === 422)
        ) {
          throw error
        }
        return undefined
      }
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
