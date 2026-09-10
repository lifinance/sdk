import { MaxUint256 } from '../../../permits/constants.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getTypedDataInLane } from '../../../utils/getTypedDataLane.js'

/**
 * How much of the source token to approve to the step's approval address.
 *
 * MAX for LI.FI's own Permit2 flow, as before. Also MAX for a caller-supplied
 * Permit2 intent, but only when `step.estimate.approvalAddress` is the
 * contract the intent names in `domain.verifyingContract` — for any Permit2
 * EIP-712 message, the Permit2 deployment itself. The unlimited approval can
 * then only land on the contract written inside the message the user signs.
 *
 * `every`, not `some`: two intents naming different Permit2 deployments must
 * not earn an unlimited approval on the strength of one.
 */
export function getApprovalAmount(
  context: EthereumStepExecutorContext,
  permit2Supported: boolean
): bigint {
  const { step, fromChain, disableMessageSigning } = context

  if (permit2Supported) {
    return MaxUint256
  }

  // `EthereumSignStepIntentTask.shouldRun` reads the same flag — the provider
  // option, or any `step.type !== 'lifi'` — and drops the intent, so nobody
  // signed a contract for the unlimited approval to validate.
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
