import type { EthereumStepExecutorContext } from '../../../types.js'
import {
  getTypedDataLane,
  hasCallerIntent,
  hasRelayerIntent,
} from '../../../utils/getTypedDataLane.js'

/**
 * Whether this execution is carrying a caller-supplied Permit2 intent, from
 * either source.
 *
 * `step.typedData` is the caller's declaration, and `preserveCallerIntents`
 * keeps it alive through `EthereumPrepareTransactionTask`, which would
 * otherwise let an explicit `typedData: []` from the API erase it.
 * `context.signedTypedData` records what this execution actually signed and is
 * read as well: the two sources are defence in depth for a gate whose failure
 * destroys a transaction. Neither subsumes the other — with
 * `disableMessageSigning`, the intent is declared but never signed.
 *
 * Call {@link isCallerIntentLaneInFlight}, not this: on its own this fold says
 * nothing about the relayer lane, and a mixed-lane step must keep both the
 * native-permit wrap and the Permit2 wrap available.
 */
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

/**
 * `isCallerIntentLane` from `utils/getTypedDataLane.js`, for gates that run after
 * `EthereumPrepareTransactionTask` may have replaced `step.typedData` with the
 * API's answer. Reads the signed record too, so the verdict survives.
 */
export function isCallerIntentLaneInFlight(
  context: EthereumStepExecutorContext
): boolean {
  return (
    hasCallerIntentInFlight(context) &&
    !hasRelayerIntent(context.step, context.fromChain)
  )
}
