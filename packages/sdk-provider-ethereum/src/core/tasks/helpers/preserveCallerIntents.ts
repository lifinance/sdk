import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'
import {
  getTypedDataLane,
  isCallerIntentLane,
} from '../../../utils/getTypedDataLane.js'

/**
 * The typed data to write back onto the step after `/advanced/stepTransaction`
 * answers.
 *
 * The API answers a caller-supplied Permit2 intent with the signature already
 * embedded in the calldata and an empty `typedData`, which would otherwise
 * erase the declaration from the shared step object for good. That declaration
 * is the only durable record that the step is caller-executed:
 * `context.signedTypedData` is rebuilt empty on every `executeStep`, so a
 * resume or an EIP-7702 `atomicityNotReady` retry would find no caller intent,
 * skip re-signing it, and let the Permit2 proxy flow hijack the caller's
 * calldata.
 *
 * Only the caller-intent lane is preserved, and the lane is checked on both
 * sides of the call:
 *
 * - A step that already carries a relayer intent belongs to the relayer. It
 *   re-quotes through `getRelayerUpdatedStep`, which must stay free to drop
 *   every entry the step has, and its caller intent is never signed here
 *   anyway — `EthereumSignStepIntentTask` skips that shape.
 * - An answer that declares a lane of its own speaks for itself. A caller
 *   intent in it means the declaration survived. A relayer intent in it means
 *   the step has moved to the relayer, where an appended caller intent would be
 *   signed a second time: `EthereumRelayedSignAndExecuteTask` filters only
 *   native permits out of its signing loop, because `isNativePermitValid`
 *   returns false for every other primary type.
 */
export function preserveCallerIntents(
  step: LiFiStepExtended | LiFiStep,
  updatedTypedData: TypedData[] | undefined,
  chain: ExtendedChain
): TypedData[] | undefined {
  if (!updatedTypedData) {
    return step.typedData
  }

  if (!isCallerIntentLane(step, chain)) {
    return updatedTypedData
  }

  const answerDeclaresLane = updatedTypedData.some((typedData) => {
    const lane = getTypedDataLane(typedData, chain)
    return lane === 'caller-intent' || lane === 'relayer-intent'
  })
  if (answerDeclaresLane) {
    return updatedTypedData
  }

  const callerIntents = (step.typedData ?? []).filter(
    (typedData) => getTypedDataLane(typedData, chain) === 'caller-intent'
  )

  return [...updatedTypedData, ...callerIntents]
}
