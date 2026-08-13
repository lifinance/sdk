import type { Route } from '@lifi/types'
import { getFundingOrder } from '../actions/getFundingOrder.js'
import { waitForFundingOrder } from '../actions/waitForFundingOrder.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError, ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import type { SDKClient } from '../types/core.js'
import type { FundingExecutionOptions, FundingOrder } from '../types/funding.js'
import { convertOrderToRoute } from '../utils/convertOrderToRoute.js'
import { executeRoute, getActiveRoute, resumeRoute } from './execution.js'

export type { FundingExecutionOptions } from '../types/funding.js'

const isTerminal = (order: FundingOrder | undefined): boolean =>
  order?.status === 'DONE' || order?.status === 'FAILED'

const waitOnly = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions,
  sourceTxHash?: string
): Promise<FundingOrder> =>
  waitForFundingOrder(client, order.orderId, {
    pollingInterval: options?.pollingInterval,
    timeout: options?.timeout,
    integrator: options?.integrator,
    signal: options?.signal,
    txHash: sourceTxHash,
    onUpdate: options?.onOrderUpdate,
  })

/**
 * Run a route through the pipeline and return the terminal order.
 * The terminal order arrives through the onOrderUpdate capture, so no extra
 * read is needed on the common path.
 */
const runAndCapture = async (
  client: SDKClient,
  route: Route,
  orderId: string,
  options: FundingExecutionOptions | undefined,
  run: (
    client: SDKClient,
    route: Route,
    options?: FundingExecutionOptions
  ) => Promise<unknown>
): Promise<FundingOrder> => {
  let latest: FundingOrder | undefined
  await run(client, route, {
    ...options,
    onOrderUpdate: (order: FundingOrder) => {
      latest = order
      options?.onOrderUpdate?.(order)
    },
  })
  if (isTerminal(latest)) {
    return latest!
  }
  // No transition fired - read once before giving up.
  const refetched = await getFundingOrder(client, orderId, {
    ...(options?.integrator && { integrator: options.integrator }),
  })
  if (isTerminal(refetched)) {
    // The wrapper above never saw this order, and on layer 2 this read is the
    // only decider. Report it, or the caller resolves with a terminal order
    // having received no transition at all.
    options?.onOrderUpdate?.(refetched)
    return refetched
  }
  // The execution stopped before a terminal state: a poll timeout, a PAUSED
  // task under executeInBackground, or stopRouteExecution. All three mean the
  // same thing to the caller - resume later.
  throw new SDKError(
    new TransactionError(
      LiFiErrorCode.Timeout,
      `Funding order ${orderId} execution stopped before a terminal state. Resume it.`
    )
  )
}

/**
 * Execute a funding order. STANDARD orders run through the standard route
 * execution pipeline (allowance, sign, send) and then track the order to a
 * terminal state. SMART_DEPOSIT and ONRAMP orders only poll - rendering the
 * deposit QR or the on-ramp widget is the caller's job.
 *
 * A resolve always means the order is terminal, DONE or FAILED, for every
 * order type. Check `order.status` to tell them apart.
 * `onOrderUpdate` fires on order transitions only. It does NOT fire when a
 * DONE order is returned unchanged on the early-return path below: the return
 * value is authoritative, and firing there would invent a transition that
 * never happened. Read the resolved order, do not rely on the callback alone.
 * @param client - The SDK client.
 * @param order - The funding order to execute. Must be a newly created order
 * that has not been sent yet. This function does not re-read the order: it
 * converts the snapshot straight to a route and executes it. `executeRoute`
 * dedupes by route id, so a second call issued while the execution is still
 * live in the same process attaches to the running promise instead of sending
 * twice. That is the only case it covers: `executionState` is in-memory, and
 * `stopRouteExecution` deletes the entry on any non-DONE step outcome. So a
 * reload, a second process, or a retry after a pause or a poll timeout rebuilds
 * the route with no execution history, starts the pipeline from the front, and
 * signs and sends a second funding transaction. Use `resumeFundingOrder` for
 * any order that may have been sent - it re-reads the order and carries the
 * source-transaction guard.
 * @param options - Execution options, including route execution hooks for STANDARD orders.
 * @throws {SDKError} ValidationError for a FAILED input order - create a new order instead. ValidationError from `convertOrderToRoute` when a STANDARD order carries no `quote`, which a partial or hand-built order snapshot can hit. TransactionError with LiFiErrorCode.Timeout when the execution stops before a terminal order; the order stays PENDING and can be resumed.
 * @throws {DOMException} On the poll-only paths - SMART_DEPOSIT, ONRAMP, and the resume branch that only polls - an abort rejects with the bare `options.signal.reason`, NOT wrapped in an SDKError, so do not branch on `instanceof SDKError` to detect cancellation there. On a STANDARD order executing through the route pipeline, the abort is instead surfaced by the provider error parser as an SDKError; check `options.signal.aborted` if you need one test that covers both paths. Mind the timing on a STANDARD order: `signal` reaches only the funding poll, through `context.executionOptions` into `WaitForFundingOrderTask`. Nothing else in route execution consumes it, so an abort during the allowance, signing or receipt phase has NO effect until polling starts.
 * @returns The terminal funding order, DONE or FAILED.
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
  return runAndCapture(
    client,
    convertOrderToRoute(order),
    order.orderId,
    options,
    executeRoute
  )
}

/**
 * Resume a funding order. Re-reads the order first, then takes the first
 * layer that applies:
 *
 * 1. terminal order - return it;
 * 2. a live in-memory route - resume that, so the call attaches to the running
 *    execution instead of starting a second one;
 * 3. a source transaction already exists (reported by the order, or supplied
 *    as `options.sourceTxHash`) - poll only, never re-send;
 * 4. nothing sent yet - rebuild the route and resume.
 *
 * Layer 2 applies less often than it looks: `getActiveRoute` reads `executionState`,
 * and `stopRouteExecution` deletes that entry, which `executeSteps` calls on every
 * non-DONE step outcome - including a poll timeout. So layer 2 covers a resume issued
 * while an execution is still live, not a resume after a pause, a background/foreground
 * transition, or a retry. Layer 3 carries the guard in all of those.
 *
 * Layer 3 needs `sourceTxHash` because the backend sets `result.fromTxHash`
 * only after it attributes the transfer. Without it, a reload inside that
 * window would send the funding transaction a second time.
 *
 * A resolve always means the order is terminal, DONE or FAILED.
 *
 * `onOrderUpdate` fires on order transitions only. It does NOT fire on layer 1,
 * where the re-read order is already terminal and is returned as is: the return
 * value is authoritative, and firing there would invent a transition that never
 * happened. Read the resolved order, do not rely on the callback alone.
 * @param client - The SDK client.
 * @param order - The funding order to resume. Only `orderId` is read - the
 * function re-reads the order, so a stale snapshot is safe here.
 * @param options - Execution options. Pass `sourceTxHash` when the caller persisted one.
 * @throws {SDKError} TransactionError with LiFiErrorCode.Timeout when the execution stops before a terminal order; the order stays PENDING and can be resumed again. ValidationError from `convertOrderToRoute` when the re-read STANDARD order carries no `quote`.
 * @throws {DOMException} On the poll-only paths - SMART_DEPOSIT, ONRAMP, and the resume branch that only polls - an abort rejects with the bare `options.signal.reason`, NOT wrapped in an SDKError, so do not branch on `instanceof SDKError` to detect cancellation there. On a STANDARD order executing through the route pipeline, the abort is instead surfaced by the provider error parser as an SDKError; check `options.signal.aborted` if you need one test that covers both paths. Mind the timing on a STANDARD order: `signal` reaches only the funding poll, through `context.executionOptions` into `WaitForFundingOrderTask`. Nothing else in route execution consumes it, so an abort during the allowance, signing or receipt phase has NO effect until polling starts.
 * @returns The terminal funding order, DONE or FAILED.
 */
export const resumeFundingOrder = async (
  client: SDKClient,
  order: FundingOrder,
  options?: FundingExecutionOptions
): Promise<FundingOrder> => {
  const fresh = await getFundingOrder(client, order.orderId, {
    ...(options?.integrator && { integrator: options.integrator }),
  })
  if (isTerminal(fresh)) {
    return fresh
  }

  const live = getActiveRoute(fresh.orderId)
  if (live) {
    return runAndCapture(client, live, fresh.orderId, options, resumeRoute)
  }

  // Truthiness, not ??: an empty fromTxHash is no hash at all, and masking the
  // caller's hash with one would send the funding transaction a second time.
  // Only STANDARD orders may report a source transaction - ?txHash= is rejected
  // for the other types - so the hash is scoped to that branch.
  const sourceTxHash =
    fresh.type === 'STANDARD'
      ? fresh.result?.fromTxHash || options?.sourceTxHash
      : undefined
  if (fresh.type !== 'STANDARD' || sourceTxHash) {
    return waitOnly(client, fresh, options, sourceTxHash)
  }

  return runAndCapture(
    client,
    convertOrderToRoute(fresh),
    fresh.orderId,
    options,
    resumeRoute
  )
}
