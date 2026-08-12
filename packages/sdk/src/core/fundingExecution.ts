import { getFundingOrder } from '../actions/getFundingOrder.js'
import { waitForFundingOrder } from '../actions/waitForFundingOrder.js'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import type { FundingExecutionOptions, FundingOrder } from '../types/funding.js'
import { convertOrderToRoute } from '../utils/convertOrderToRoute.js'
import { executeRoute, resumeRoute } from './execution.js'

export type { FundingExecutionOptions } from '../types/funding.js'

const waitOnly = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions
): Promise<FundingOrder> => {
  return waitForFundingOrder(client, order.orderId, {
    pollingInterval: options?.pollingInterval,
    timeout: options?.timeout,
    onUpdate: options?.onOrderUpdate,
  })
}

/**
 * Execute a funding order. STANDARD orders run through the standard route
 * execution pipeline (allowance, sign, send) and then track the order to a
 * terminal state. SMART_DEPOSIT and ONRAMP orders only poll - rendering the
 * deposit QR or the on-ramp widget is the caller's job.
 *
 * FAILED outcome is asymmetric by order type: a STANDARD order that ends
 * FAILED rejects (the route execution pipeline throws). A SMART_DEPOSIT or
 * ONRAMP order that ends FAILED resolves with the terminal order - the
 * caller must check `order.status` to detect failure.
 * @param client - The SDK client.
 * @param order - The funding order to execute. Must not be FAILED.
 * @param options - Execution options, including route execution hooks for STANDARD orders.
 * @throws {SDKError} ValidationError for a FAILED order - create a new order instead. Also rejects on a STANDARD order that ends FAILED during execution (pipeline throw).
 * @returns The terminal funding order. For SMART_DEPOSIT/ONRAMP orders this resolves even when the terminal status is FAILED.
 */
export const executeFundingOrder = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions
): Promise<FundingOrder> => {
  if (order.status === 'FAILED') {
    throw new SDKError(
      new ValidationError(
        `Funding order ${order.orderId} is FAILED. Create a new order with a new partnerOrderId instead.`
      )
    )
  }
  if (order.status === 'DONE') {
    return order
  }
  if (order.type !== 'STANDARD') {
    return waitOnly(client, order, options)
  }
  const route = convertOrderToRoute(order)
  await executeRoute(client, route, options)
  return getFundingOrder(client, order.orderId)
}

/**
 * Resume a funding order. Re-fetches the order first: terminal orders return
 * immediately; orders whose source transaction was already sent skip straight
 * to polling; otherwise the STANDARD route pipeline resumes.
 *
 * FAILED outcome depends on which of the three branches above handles the
 * refreshed order, not just its type. The refetched order is already FAILED,
 * or it is a STANDARD order whose source transaction was already sent (so
 * this call only polls): resolves with the FAILED order either way - check
 * `order.status`. Only the third branch - a STANDARD order still resuming
 * the route pipeline - rejects when it ends FAILED (pipeline throw).
 * @param client - The SDK client.
 * @param order - The funding order to resume.
 * @param options - Execution options.
 * @returns The terminal funding order. Resolves even when the terminal status is FAILED, except when the route pipeline itself rejects.
 */
export const resumeFundingOrder = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions
): Promise<FundingOrder> => {
  const fresh = await getFundingOrder(client, order.orderId)
  if (fresh.status === 'DONE' || fresh.status === 'FAILED') {
    return fresh
  }
  if (fresh.type !== 'STANDARD' || fresh.result?.fromTxHash) {
    return waitOnly(client, fresh, options)
  }
  const route = convertOrderToRoute(fresh)
  await resumeRoute(client, route, options)
  return getFundingOrder(client, fresh.orderId)
}
