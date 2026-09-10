import type {
  ExtendedChain,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'
import {
  getTypedDataInLane,
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
 * sides of the call. A step that already carries a relayer intent belongs to
 * the relayer, whose re-quote must stay free to drop every entry. An answer
 * that declares a lane of its own speaks for itself: appending a caller intent
 * to a relayer answer would get it signed a second time, because
 * `EthereumRelayedSignAndExecuteTask` filters only native permits out.
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

  return [
    ...updatedTypedData,
    ...getTypedDataInLane(step, 'caller-intent', chain),
  ]
}
