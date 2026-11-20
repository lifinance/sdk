import type { LiFiStep } from '@lifi/sdk'
import { MaxUint256 } from '../../../permits/constants.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getTypedDataInLane } from '../../../utils/getTypedDataLane.js'

// Drop the cast once @lifi/types ships `Estimate.approvalAmount`.
const getEstimateApprovalAmount = (step: LiFiStep): bigint | undefined => {
  const { approvalAmount } = step.estimate as { approvalAmount?: string }
  return approvalAmount ? BigInt(approvalAmount) : undefined
}

/**
 * The allowance the step needs on its spender. Outside the SDK's own Permit2
 * flow the spender is `approvalAddress`, so `estimate.approvalAmount` applies.
 */
export function getRequiredAllowance(
  context: EthereumStepExecutorContext,
  permit2Supported: boolean
): bigint {
  const { step } = context
  const fromAmount = BigInt(step.action.fromAmount)
  if (permit2Supported) {
    return fromAmount
  }
  return getEstimateApprovalAmount(step) ?? fromAmount
}

/** How much of the source token to approve to the step's approval address. */
export function getApprovalAmount(
  context: EthereumStepExecutorContext,
  permit2Supported: boolean
): bigint {
  const { step, fromChain, disableMessageSigning } = context

  if (permit2Supported) {
    return MaxUint256
  }

  const estimateApprovalAmount = getEstimateApprovalAmount(step)
  if (estimateApprovalAmount !== undefined) {
    return estimateApprovalAmount
  }

  const permit2Allowances = disableMessageSigning
    ? []
    : getTypedDataInLane(step, 'permit2-allowance', fromChain)

  const approvalAddress = step.estimate.approvalAddress?.toLowerCase()
  const targetsApprovalAddress =
    permit2Allowances.length > 0 &&
    !!approvalAddress &&
    permit2Allowances.every(
      (typedData) =>
        typedData.domain.verifyingContract?.toLowerCase() === approvalAddress
    )

  return targetsApprovalAddress ? MaxUint256 : BigInt(step.action.fromAmount)
}
