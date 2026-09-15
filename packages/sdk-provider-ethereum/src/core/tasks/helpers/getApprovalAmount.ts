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

  const callerIntents = disableMessageSigning
    ? []
    : getTypedDataInLane(step, 'caller-intent', fromChain)

  const approvalAddress = step.estimate.approvalAddress?.toLowerCase()
  const targetsApprovalAddress =
    callerIntents.length > 0 &&
    !!approvalAddress &&
    callerIntents.every(
      (typedData) =>
        typedData.domain.verifyingContract?.toLowerCase() === approvalAddress
    )

  return targetsApprovalAddress ? MaxUint256 : BigInt(step.action.fromAmount)
}
