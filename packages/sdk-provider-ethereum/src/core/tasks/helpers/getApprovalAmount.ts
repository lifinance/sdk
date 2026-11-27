import { MaxUint256 } from '../../../permits/constants.js'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { getTypedDataInLane } from '../../../utils/getTypedDataLane.js'

// Some tokens store a capped allowance (UNI and COMP store a uint96), and some
// lower an unlimited allowance on every transferFrom. An allowance at or above
// this floor counts as unlimited.
const UNLIMITED_ALLOWANCE_FLOOR = 2n ** 96n - 1n

const maxOf = (a: bigint, b: bigint): bigint => (a > b ? a : b)

/** Whether the approval goes to the Permit2 contract that the step's `PermitSingle` names. */
const targetsPermit2 = (context: EthereumStepExecutorContext): boolean => {
  const { step, fromChain, disableMessageSigning } = context
  const approvalAddress = step.estimate.approvalAddress?.toLowerCase()
  const permit2Allowances = disableMessageSigning
    ? []
    : getTypedDataInLane(step, 'permit2-allowance', fromChain)
  return (
    !!approvalAddress &&
    permit2Allowances.length > 0 &&
    permit2Allowances.every(
      (typedData) =>
        typedData.domain.verifyingContract?.toLowerCase() === approvalAddress
    )
  )
}

/** `estimate.approvalAmount`, never less than `fromAmount`. */
// Drop the cast once @lifi/types ships `Estimate.approvalAmount`.
const getEstimateApprovalAmount = (
  context: EthereumStepExecutorContext
): bigint => {
  const fromAmount = BigInt(context.step.action.fromAmount)
  const { approvalAmount } = context.step.estimate as {
    approvalAmount?: string
  }
  return approvalAmount ? maxOf(BigInt(approvalAmount), fromAmount) : fromAmount
}

/** The allowance the step needs on its spender. */
export function getRequiredAllowance(
  context: EthereumStepExecutorContext,
  permit2Supported: boolean
): bigint {
  const fromAmount = BigInt(context.step.action.fromAmount)
  if (permit2Supported || targetsPermit2(context)) {
    return fromAmount
  }
  const amount = getEstimateApprovalAmount(context)
  return amount === MaxUint256
    ? maxOf(fromAmount, UNLIMITED_ALLOWANCE_FLOOR)
    : amount
}

/** How much of the source token to approve to the step's spender. */
export function getApprovalAmount(
  context: EthereumStepExecutorContext,
  permit2Supported: boolean
): bigint {
  if (permit2Supported || targetsPermit2(context)) {
    return MaxUint256
  }
  return getEstimateApprovalAmount(context)
}
