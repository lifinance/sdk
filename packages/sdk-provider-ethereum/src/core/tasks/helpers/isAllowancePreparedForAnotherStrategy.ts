import type { TransactionMethodType } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { resolvePermit2Support } from './resolvePermit2Support.js'

/**
 * Whether the allowance tasks, which ran in `preparedFor`, left the step unable
 * to execute in `needed` — the strategy prepare established from the re-quote.
 *
 * Two outcomes of those tasks depend on the strategy, and either one can break:
 * - Calls queued for a batch are sent only by the batched task.
 * - The spender. `resolvePermit2Support` rejects `batched`, answers the relayed
 *   lane without probing and probes the signer for `standard`, so the same step
 *   is checked against `approvalAddress` in one strategy and needs canonical
 *   Permit2 in another. A sufficient allowance to the wrong spender queues
 *   nothing, so the calls alone do not show it.
 *
 * The spender is compared with the one `EthereumCheckAllowanceTask` recorded,
 * not derived again: prepare has already replaced the step's typed data and
 * estimate with the re-quote's.
 */
export const isAllowancePreparedForAnotherStrategy = async (
  context: EthereumStepExecutorContext,
  preparedFor: TransactionMethodType,
  needed: TransactionMethodType
): Promise<boolean> => {
  if (preparedFor === needed) {
    return false
  }
  if (preparedFor === 'batched' && context.calls.length) {
    return true
  }
  // A signed native permit covers the allowance, and the re-quote carries it.
  if (context.hasMatchingPermit) {
    return false
  }
  const { allowanceSpender, fromChain, step } = context
  if (!allowanceSpender) {
    return false
  }
  const neededSpender = (await resolvePermit2Support(context, needed))
    ? fromChain.permit2
    : step.estimate.approvalAddress
  return allowanceSpender.toLowerCase() !== neededSpender?.toLowerCase()
}
