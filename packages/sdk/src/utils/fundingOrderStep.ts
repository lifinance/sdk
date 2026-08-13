import type { LiFiStep } from '@lifi/types'
import { getFundingOrder } from '../actions/getFundingOrder.js'
import { LiFiErrorCode } from '../errors/constants.js'
import { TransactionError, ValidationError } from '../errors/errors.js'
import type { LiFiStepExtended, SDKClient } from '../types/core.js'

/**
 * Whether a step was derived from a funding order and must use the funding
 * execution branch (committed quote, order-endpoint status).
 */
export function isFundingOrderStep(
  step: LiFiStep | LiFiStepExtended
): step is LiFiStepExtended & { fundingOrderId: string } {
  const id = (step as LiFiStepExtended).fundingOrderId
  return typeof id === 'string' && id.length > 0
}

/**
 * Restore the committed quote of a funding order onto a step.
 * Funding orders have no re-quote endpoint — the order itself stores the
 * committed quote, so a refresh is a plain order read.
 * @throws {ValidationError} when the step is not a funding order step (no fundingOrderId).
 * @throws {TransactionError} TransactionUnprepared when the order has no executable quote.
 */
export async function getFundingOrderUpdatedStep(
  client: SDKClient,
  step: LiFiStepExtended
): Promise<LiFiStepExtended> {
  if (!step.fundingOrderId) {
    throw new ValidationError(
      'Step is not a funding order step. getFundingOrderUpdatedStep requires a step with fundingOrderId.'
    )
  }
  const order = await getFundingOrder(client, step.fundingOrderId)
  if (!order.quote?.transactionRequest) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'Unable to prepare transaction. The funding order quote has no transaction request.'
    )
  }
  // Drop typedData for the reason convertOrderToRoute spells out in full: the
  // two gates that act on it never consult skipPermit, so a funding step
  // carrying typed data would route to the relayer and bypass the committed
  // transactionRequest. convertOrderToRoute covers construction; this covers
  // refresh, where a re-read quote could otherwise reintroduce it. An object
  // literal cannot `delete`, so drop it by destructuring.
  const { typedData: _, ...quote } = order.quote
  return {
    ...quote,
    // Copy the estimate so the marker cannot leak into the fetched order.
    estimate: { ...quote.estimate, skipPermit: true },
    id: step.id,
    fundingOrderId: step.fundingOrderId,
    execution: step.execution,
  }
}
