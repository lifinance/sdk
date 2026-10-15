import type { EthereumStepExecutorContext } from '../../../types.js'
import { resolveAllowanceSpender } from './resolveAllowanceSpender.js'

/**
 * Whether the re-quote moved `estimate.approvalAddress` away from the spender
 * the allowance tasks checked before prepare. The Permit2 lane is left out:
 * its spender is `chain.permit2` whatever the re-quote says.
 */
export const hasAllowanceSpenderChanged = async (
  context: EthereumStepExecutorContext
): Promise<boolean> => {
  const { step, allowanceSpender, hasMatchingPermit, executionStrategy } =
    context
  if (
    !allowanceSpender ||
    hasMatchingPermit ||
    !executionStrategy ||
    step.estimate.skipApproval
  ) {
    return false
  }
  const { permit2Supported, spenderAddress } = await resolveAllowanceSpender(
    context,
    executionStrategy
  )
  return (
    !permit2Supported &&
    !!spenderAddress &&
    spenderAddress.toLowerCase() !== allowanceSpender.toLowerCase()
  )
}
