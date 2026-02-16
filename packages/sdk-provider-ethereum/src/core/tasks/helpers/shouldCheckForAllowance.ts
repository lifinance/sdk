import type { LiFiStepExtended, StatusManager } from '@lifi/sdk'

export const shouldCheckForAllowance = (
  step: LiFiStepExtended,
  isBridgeExecution: boolean,
  isFromNativeToken: boolean,
  statusManager: StatusManager
) => {
  const exchangeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

  const swapOrBridgeAction = statusManager.findAction(step, exchangeActionType)

  return (
    // No existing swap/bridge transaction is pending
    !swapOrBridgeAction?.txHash &&
    // No existing swap/bridge batch/order is pending
    !swapOrBridgeAction?.taskId &&
    // Token is not native (address is not zero)
    !isFromNativeToken &&
    // Approval address is required for allowance checks, but may be null in special cases (e.g. direct transfers)
    !!step.estimate.approvalAddress &&
    !step.estimate.skipApproval
  )
}
