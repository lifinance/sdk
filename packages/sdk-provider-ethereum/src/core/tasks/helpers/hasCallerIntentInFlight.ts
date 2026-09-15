import type { EthereumStepExecutorContext } from '../../../types.js'
import {
  getTypedDataLane,
  hasCallerIntent,
  hasRelayerIntent,
} from '../../../utils/getTypedDataLane.js'

/** Whether this execution carries a caller-supplied Permit2 intent, declared or signed. */
export function hasCallerIntentInFlight(
  context: EthereumStepExecutorContext
): boolean {
  const { step, fromChain, signedTypedData } = context

  return (
    hasCallerIntent(step, fromChain) ||
    signedTypedData.some(
      (typedData) => getTypedDataLane(typedData, fromChain) === 'caller-intent'
    )
  )
}

/** `isCallerIntentLane`, for gates that run after prepare may have replaced `step.typedData`. */
export function isCallerIntentLaneInFlight(
  context: EthereumStepExecutorContext
): boolean {
  return (
    hasCallerIntentInFlight(context) &&
    !hasRelayerIntent(context.step, context.fromChain)
  )
}
