import {
  hasOpenTransaction,
  type LiFiStepExtended,
  type StatusManager,
} from '@lifi/sdk'

export const shouldCheckForAllowance = (
  step: LiFiStepExtended,
  isBridgeExecution: boolean,
  isFromNativeToken: boolean,
  statusManager: StatusManager
): boolean => {
  const exchangeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

  const swapOrBridgeAction = statusManager.findAction(step, exchangeActionType)

  return (
    // No swap/bridge transaction (hash, batch/relay id or stored bytes) that may
    // still land. A FAILED action with a final outcome does not count, so the
    // allowance is checked again before the new transaction.
    !hasOpenTransaction(swapOrBridgeAction) &&
    // Token is not native (address is not zero)
    !isFromNativeToken &&
    // Approval address is required for allowance checks, but may be null in special cases (e.g. direct transfers)
    !!step.estimate.approvalAddress &&
    !step.estimate.skipApproval
  )
}
