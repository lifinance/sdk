import type { EthereumStepExecutorContext } from '../../../types.js'
import {
  getTypedDataLane,
  hasCallerIntent,
} from '../../../utils/getTypedDataLane.js'

/**
 * Whether this execution is carrying a caller-supplied Permit2 intent, from
 * either source.
 *
 * `step.typedData` is the caller's declaration, but
 * `EthereumPrepareTransactionTask` overwrites it with
 * `updatedStep.typedData ?? step.typedData`, and an explicit `typedData: []`
 * from the API is not nullish — it wins the `??` and erases the declaration.
 * `context.signedTypedData` records what this execution actually signed, so it
 * survives that. Neither source subsumes the other: with
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
