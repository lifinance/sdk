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
 * `??` keeps the caller's intent only when the answer omits `typedData`. An
 * answer that carries entries of its own — native permits, or `[]` from a
 * third-party backend — would drop it, and `signedTypedData` resets per
 * `executeStep`, so a retry would let the Permit2 proxy hijack the calldata.
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
