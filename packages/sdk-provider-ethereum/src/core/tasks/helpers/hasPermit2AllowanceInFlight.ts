import type { EthereumStepExecutorContext } from '../../../types.js'
import {
  getTypedDataLane,
  hasPermit2Allowance,
  hasRelayerMessage,
} from '../../../utils/getTypedDataLane.js'

/** Whether this execution carries a caller-supplied Permit2 allowance, declared or signed. */
export function hasPermit2AllowanceInFlight(
  context: EthereumStepExecutorContext
): boolean {
  const { step, fromChain, signedTypedData } = context

  return (
    hasPermit2Allowance(step, fromChain) ||
    signedTypedData.some(
      (typedData) =>
        getTypedDataLane(typedData, fromChain) === 'permit2-allowance'
    )
  )
}

/** `isPermit2AllowanceLane`, for gates that run after prepare may have replaced `step.typedData`. */
export function isPermit2AllowanceLaneInFlight(
  context: EthereumStepExecutorContext
): boolean {
  return (
    hasPermit2AllowanceInFlight(context) &&
    !hasRelayerMessage(context.step, context.fromChain)
  )
}
