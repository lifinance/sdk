import type { EthereumStepExecutorContext } from '../../../types.js'
import { shouldCheckForAllowance } from './shouldCheckForAllowance.js'

/**
 * Whether the step had no `estimate.approvalAddress` before prepare and the
 * re-quote brought one. No allowance was checked then (`allowanceSpender` is
 * unset), and the step now needs it checked. The allowance tasks resolve the
 * spender themselves, so on a Permit2 chain they approve `fromChain.permit2`.
 */
export const hasApprovalAddressAppearedAtPrepare = (
  context: EthereumStepExecutorContext
): boolean => {
  const {
    step,
    allowanceSpender,
    isBridgeExecution,
    isFromNativeToken,
    statusManager,
  } = context
  return (
    !allowanceSpender &&
    shouldCheckForAllowance(
      step,
      isBridgeExecution,
      isFromNativeToken,
      statusManager
    )
  )
}
