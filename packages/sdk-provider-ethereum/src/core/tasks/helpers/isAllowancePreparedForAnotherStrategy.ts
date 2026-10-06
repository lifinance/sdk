import type { TransactionMethodType } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { resolveAllowanceSpender } from './resolveAllowanceSpender.js'

/**
 * Whether the allowance work done in `preparedFor` does not fit `needed`, the
 * strategy prepare established. Two things can break:
 * - Calls queued for a batch are sent only by the batched task.
 * - The spender: `resolvePermit2Support` never picks Permit2 for `batched`, but
 *   can for the other strategies. An allowance that is sufficient for the wrong
 *   spender queues nothing, so the calls alone do not show it.
 *
 * The spender recorded by `EthereumCheckAllowanceTask` is compared, because
 * prepare has already replaced the step with the re-quote.
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
  const { allowanceSpender } = context
  if (!allowanceSpender) {
    return false
  }
  const { spenderAddress } = await resolveAllowanceSpender(context, needed)
  return allowanceSpender.toLowerCase() !== spenderAddress?.toLowerCase()
}
