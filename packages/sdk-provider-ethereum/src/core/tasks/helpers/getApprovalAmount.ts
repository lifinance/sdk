import { MaxUint256 } from '../../../permits/constants.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getTypedDataInLane } from '../../../utils/getTypedDataLane.js'

/** How much of the source token to approve to the step's approval address. */
export function getApprovalAmount(
  context: EthereumStepExecutorContext,
  permit2Supported: boolean
): bigint {
  const { step, fromChain, disableMessageSigning } = context

  if (permit2Supported) {
    return MaxUint256
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
