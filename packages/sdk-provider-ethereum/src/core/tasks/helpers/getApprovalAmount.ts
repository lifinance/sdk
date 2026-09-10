import { MaxUint256 } from '../../../permits/constants.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getTypedDataInLane } from '../../../utils/getTypedDataLane.js'

/**
 * How much of the source token to approve to the step's approval address.
 *
 * MAX for LI.FI's own Permit2 flow, as before. Also MAX for a caller-supplied
 * Permit2 intent, but only when `step.estimate.approvalAddress` is the very
 * contract the intent names in `domain.verifyingContract` — which, for any
 * Permit2 EIP-712 message, is the Permit2 deployment itself. That makes the
 * unlimited approval self-validating: it can only ever land on the contract
 * written inside the message the user signs. Repeat swaps then need a signature
 * and no approval. That argument needs the user to actually sign, so
 * `disableMessageSigning` takes the unlimited approval off the table.
 *
 * `every`, not `some`: a step carrying two intents that name different Permit2
 * deployments must not earn an unlimited approval on the strength of one.
 */
export function getApprovalAmount(
  context: EthereumStepExecutorContext,
  permit2Supported: boolean
): bigint {
  const { step, fromChain, disableMessageSigning } = context

  if (permit2Supported) {
    return MaxUint256
  }

  // `EthereumSignStepIntentTask.shouldRun` reads `disableMessageSigning` too,
  // and drops the intent when it is set — the provider option, or any
  // `step.type !== 'lifi'`. The user is then never shown the message, so there
  // is no signed contract for the unlimited approval to be validated against
  // and it falls back to the swap amount.
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
