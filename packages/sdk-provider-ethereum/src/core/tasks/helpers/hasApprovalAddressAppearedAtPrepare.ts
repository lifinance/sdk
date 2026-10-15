import type { EthereumStepExecutorContext } from '../../../types.js'
import { resolveAllowanceSpender } from './resolveAllowanceSpender.js'
import { shouldCheckForAllowance } from './shouldCheckForAllowance.js'

/**
 * Whether the step had no `estimate.approvalAddress` before prepare and the
 * re-quote brought one. No allowance was checked then (`allowanceSpender` is
 * unset), and the step now needs it checked. The Permit2 lane is left out: its
 * allowance and signature tasks run before prepare.
 */
export const hasApprovalAddressAppearedAtPrepare = async (
  context: EthereumStepExecutorContext
): Promise<boolean> => {
  const {
    step,
    allowanceSpender,
    hasMatchingPermit,
    executionStrategy,
    isBridgeExecution,
    isFromNativeToken,
    statusManager,
  } = context
  if (
    allowanceSpender ||
    hasMatchingPermit ||
    !executionStrategy ||
    !shouldCheckForAllowance(
      step,
      isBridgeExecution,
      isFromNativeToken,
      statusManager
    )
  ) {
    return false
  }
  const { permit2Supported } = await resolveAllowanceSpender(
    context,
    executionStrategy
  )
  return !permit2Supported
}
