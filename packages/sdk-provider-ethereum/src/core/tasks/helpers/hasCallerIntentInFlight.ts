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
 * Both gates that must not hijack a caller's transaction read this — the
 * native-permit wrap and the Permit2 wrap are the two branches of one
 * decision, and protecting only one is how the second branch stayed open.
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
 * {@link isCallerIntentLane} for gates that run after `EthereumPrepareTransactionTask`, which may
 * have replaced `step.typedData` with the API's answer. Reads the signed record as well, so the
 * verdict survives even if the declaration is gone.
 */
export function isCallerIntentLaneInFlight(
  context: EthereumStepExecutorContext
): boolean {
  return (
    hasCallerIntentInFlight(context) &&
    !hasRelayerIntent(context.step, context.fromChain)
  )
}
